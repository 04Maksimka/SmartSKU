import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import (
    Assembly,
    AssemblyPick,
    AssemblyStatus,
    Box,
    Component,
    InventoryEvent,
    InventoryEventType,
    LockerState,
)
from smartsku_backend.services.errors import ConflictError, NotFoundError
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.specifications import ComponentName, SpecificationService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StockCell:
    """A calibrated cell and where it is now: the slot holding it and that slot's box, if any."""

    component: Component
    state: LockerState | None
    box: Box | None

    @property
    def usable(self) -> bool:
        """Pieces can be taken from it with the displays guiding: it is in a slot of a box on line and counted."""
        return (
            self.state is not None
            and self.box is not None
            and self.box.online
            and self.state.quantity is not None
            and self.state.calibration_step is None
        )

    @property
    def quantity(self) -> int:
        if self.usable and self.state is not None and self.state.quantity is not None:
            return self.state.quantity
        return self.component.quantity


@dataclass(frozen=True)
class ItemAvailability:
    component_name: str
    required: int
    # Cells to take from, the fullest first
    cells: list[StockCell]
    # Pieces in cells of this component that cannot be used now: pulled out, in a box off line, not counted
    elsewhere: int

    @property
    def available(self) -> int:
        return sum(cell.quantity for cell in self.cells)

    @property
    def missing(self) -> int:
        return max(0, self.required - self.available)


@dataclass(frozen=True)
class AvailabilityReport:
    specification_id: int
    name: str
    kits: int
    items: list[ItemAvailability]

    @property
    def ok(self) -> bool:
        return all(item.missing == 0 for item in self.items)

    def shortage_text(self) -> str:
        lines = [
            f"{item.component_name}: нужно {item.required}, есть {item.available}, не хватает {item.missing}"
            for item in self.items
            if item.missing
        ]
        return "Не хватает компонентов — " + "; ".join(lines)


class StockService:
    """What lies on the stands, by component name."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def cells(self) -> dict[str, list[StockCell]]:
        components = list(await self._session.scalars(select(Component)))
        states = await self._session.scalars(
            select(LockerState).where(LockerState.nfc_flag, LockerState.nfc_id.is_not(None))
        )
        boxes = {box.id: box for box in await self._session.scalars(select(Box))}
        # A box that went off line keeps its last state: the newest report of a cell is where it is now
        where: dict[str, LockerState] = {}
        for state in states:
            known = where.get(state.nfc_id or "")
            if known is None or state.updated_at > known.updated_at:
                where[state.nfc_id or ""] = state
        found: dict[str, list[StockCell]] = {}
        for component in components:
            state = where.get(component.nfc_id)
            cell = StockCell(component, state, boxes.get(state.box_id) if state else None)
            found.setdefault(ComponentName.key(component.name), []).append(cell)
        return found


@dataclass(frozen=True)
class PickProgress:
    pick: AssemblyPick
    # Pieces in the cell now: counted in its slot, or the last recorded count while it is out or not counted
    quantity: int
    # The cell is in its slot
    inserted: bool

    @property
    def taken(self) -> int:
        return self.pick.start_quantity - self.quantity

    @property
    def remaining(self) -> int:
        return self.pick.remaining(self.quantity)


@dataclass(frozen=True)
class AssemblyView:
    assembly: Assembly
    picks: list[PickProgress]


@dataclass
class ActiveAssembly:
    """The running assembly as telemetry sees it: which slot shows what."""

    assembly: Assembly
    picks: list[AssemblyPick]
    components: dict[str, Component] = field(default_factory=dict)

    def pick_for_cell(self, nfc_id: str | None) -> AssemblyPick | None:
        return next((pick for pick in self.picks if pick.nfc_id == nfc_id), None) if nfc_id else None

    def remaining_for(self, box_id: str, locker_id: int, nfc_id: str | None, quantity: int | None) -> int | None:
        """Pieces to take shown on the slot, None — the display goes dark. An empty slot keeps showing the task
        of its cell while the person has it in hands."""
        pick = self.pick_for_cell(nfc_id)
        if pick is None and nfc_id is None:
            pick = next((item for item in self.picks if (item.box_id, item.locker_id) == (box_id, locker_id)), None)
        if pick is None:
            return None
        if pick.nfc_id != nfc_id or quantity is None:
            quantity = self.confirmed_quantity(pick)
        return pick.remaining(quantity)

    def confirmed_quantity(self, pick: AssemblyPick) -> int:
        """The count the journal last recorded; a cell released meanwhile counts as untouched."""
        component = self.components.get(pick.nfc_id)
        return component.quantity if component is not None else pick.start_quantity


class AssemblyTracker:
    """Loads the running assembly and closes it: by itself when every cell holds the right count (as recorded in
    the journal, so a weight still settling does not finish it), or on the user's request."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def active(self) -> ActiveAssembly | None:
        assembly = await self._session.scalar(select(Assembly).where(Assembly.status == AssemblyStatus.ACTIVE))
        if assembly is None:
            return None
        picks = list(
            await self._session.scalars(
                select(AssemblyPick).where(AssemblyPick.assembly_id == assembly.id).order_by(AssemblyPick.id)
            )
        )
        components = await self._session.scalars(
            select(Component).where(Component.nfc_id.in_([pick.nfc_id for pick in picks]))
        )
        return ActiveAssembly(assembly, picks, {component.nfc_id: component for component in components})

    def follow_cell(self, active: ActiveAssembly, pick: AssemblyPick, box_id: str, locker_id: int) -> tuple[str, int]:
        """The cell went back into another slot: the task moves with it. Returns the old slot, whose display
        must go dark."""
        old_slot = (pick.box_id, pick.locker_id)
        pick.box_id = box_id
        pick.locker_id = locker_id
        logger.info(
            "Assembly %s: cell %s moved to box %s locker %s", active.assembly.id, pick.nfc_id, box_id, locker_id
        )
        return old_slot

    async def finish_if_done(self, active: ActiveAssembly) -> bool:
        for pick in active.picks:
            state = await self._session.get(LockerState, (pick.box_id, pick.locker_id))
            if state is None or state.logged_nfc_id != pick.nfc_id:
                return False
            if pick.remaining(active.confirmed_quantity(pick)) != 0:
                return False
        self.close(active, AssemblyStatus.COMPLETED)
        return True

    def close(self, active: ActiveAssembly, status: AssemblyStatus) -> None:
        """Marks the end in the journal, one record per cell. The caller commits and then forgets the cache, so
        the next telemetry puts every display back to counting."""
        assembly = active.assembly
        assembly.status = status
        assembly.finished_at = datetime.now(UTC)
        completed = status is AssemblyStatus.COMPLETED
        for pick in active.picks:
            quantity = active.confirmed_quantity(pick)
            pick.final_quantity = quantity
            taken = pick.start_quantity - quantity
            verb = "собрана" if completed else "прервана"
            self._session.add(
                InventoryEvent(
                    event_type=InventoryEventType.ASSEMBLY_COMPLETED
                    if completed
                    else InventoryEventType.ASSEMBLY_CANCELLED,
                    box_id=pick.box_id,
                    locker_id=pick.locker_id,
                    nfc_id=pick.nfc_id,
                    component_name=pick.component_name,
                    weight=0.0,
                    quantity_before=pick.start_quantity,
                    quantity_after=quantity,
                    note=f"{AssemblyNotes.title(assembly)} {verb}: взято {taken} из {pick.quantity}",
                    assembly_id=assembly.id,
                )
            )
        logger.info("Assembly %s %s", assembly.id, status.value)


class AssemblyNotes:
    @staticmethod
    def title(assembly: Assembly) -> str:
        kits = f" ×{assembly.kits}" if assembly.kits > 1 else ""
        return f"Сборка №{assembly.id} «{assembly.name}»{kits}"


class AssemblyService:
    """Assembling by a specification: check the stock, light up the cells to take from, follow the progress."""

    def __init__(
        self,
        session: AsyncSession,
        specifications: SpecificationService,
        stock: StockService,
        tracker: AssemblyTracker,
        cache: LockerRuntimeCache,
    ) -> None:
        self._session = session
        self._specifications = specifications
        self._stock = stock
        self._tracker = tracker
        self._cache = cache

    async def availability(self, specification_id: int, kits: int) -> AvailabilityReport:
        view = await self._specifications.get(specification_id)
        cells = await self._stock.cells()
        items = []
        for item in view.items:
            found = cells.get(ComponentName.key(item.component_name), [])
            usable = sorted((cell for cell in found if cell.usable), key=lambda cell: -cell.quantity)
            elsewhere = sum(cell.quantity for cell in found if not cell.usable)
            items.append(ItemAvailability(item.component_name, item.quantity * kits, usable, elsewhere))
        return AvailabilityReport(specification_id, view.specification.name, kits, items)

    async def start(self, specification_id: int, kits: int) -> AssemblyView:
        running = await self._tracker.active()
        if running is not None:
            raise ConflictError(f"Уже идёт {AssemblyNotes.title(running.assembly).lower()}: завершите или прервите её")
        report = await self.availability(specification_id, kits)
        if not report.ok:
            raise ConflictError(report.shortage_text())

        assembly = Assembly(specification_id=specification_id, name=report.name, kits=kits)
        self._session.add(assembly)
        await self._session.flush()
        for item in report.items:
            need = item.required
            for cell in item.cells:
                if need == 0:
                    break
                take = min(need, cell.quantity)
                if take == 0 or cell.state is None:
                    continue
                need -= take
                pick = AssemblyPick(
                    assembly_id=assembly.id,
                    component_name=item.component_name,
                    nfc_id=cell.component.nfc_id,
                    box_id=cell.state.box_id,
                    locker_id=cell.state.locker_id,
                    quantity=take,
                    start_quantity=cell.quantity,
                )
                self._session.add(pick)
                self._session.add(
                    InventoryEvent(
                        event_type=InventoryEventType.ASSEMBLY_STARTED,
                        box_id=pick.box_id,
                        locker_id=pick.locker_id,
                        nfc_id=pick.nfc_id,
                        component_name=cell.component.name,
                        weight=0.0,
                        quantity_before=pick.start_quantity,
                        quantity_after=None,
                        note=f"{AssemblyNotes.title(assembly)}: взять {take}",
                        assembly_id=assembly.id,
                    )
                )
        await self._session.commit()
        # Every box resends its indicators with the next telemetry: the assembly takes over the displays
        self._cache.forget_all()
        logger.info("Assembly %s of '%s' x%s started", assembly.id, assembly.name, kits)
        return await self.get(assembly.id)

    async def cancel(self, assembly_id: int) -> AssemblyView:
        active = await self._tracker.active()
        if active is None or active.assembly.id != assembly_id:
            assembly = await self._session.get(Assembly, assembly_id)
            if assembly is None:
                raise NotFoundError(f"Сборка {assembly_id} не найдена")
            raise ConflictError(f"Сборка {assembly_id} уже завершена")
        self._tracker.close(active, AssemblyStatus.CANCELLED)
        await self._session.commit()
        self._cache.forget_all()
        return await self.get(assembly_id)

    async def get(self, assembly_id: int) -> AssemblyView:
        assembly = await self._session.get(Assembly, assembly_id)
        if assembly is None:
            raise NotFoundError(f"Сборка {assembly_id} не найдена")
        return (await self._views([assembly]))[0]

    async def recent(self, limit: int) -> list[AssemblyView]:
        assemblies = list(await self._session.scalars(select(Assembly).order_by(Assembly.id.desc()).limit(limit)))
        return await self._views(assemblies)

    async def _views(self, assemblies: list[Assembly]) -> list[AssemblyView]:
        picks = list(
            await self._session.scalars(
                select(AssemblyPick)
                .where(AssemblyPick.assembly_id.in_([assembly.id for assembly in assemblies]))
                .order_by(AssemblyPick.id)
            )
        )
        components = {
            component.nfc_id: component
            for component in await self._session.scalars(
                select(Component).where(Component.nfc_id.in_({pick.nfc_id for pick in picks}))
            )
        }
        views = []
        for assembly in assemblies:
            progress = [
                await self._progress(pick, components.get(pick.nfc_id))
                for pick in picks
                if pick.assembly_id == assembly.id
            ]
            views.append(AssemblyView(assembly, progress))
        return views

    async def _progress(self, pick: AssemblyPick, component: Component | None) -> PickProgress:
        state = await self._session.get(LockerState, (pick.box_id, pick.locker_id))
        if pick.final_quantity is not None:
            return PickProgress(pick, pick.final_quantity, inserted=False)
        inserted = state is not None and state.nfc_flag and state.nfc_id == pick.nfc_id
        if inserted and state is not None and state.quantity is not None:
            quantity = state.quantity
        else:
            quantity = component.quantity if component is not None else pick.start_quantity
        return PickProgress(pick, quantity, inserted)
