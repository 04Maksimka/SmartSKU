from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import ClassVar

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig, LocateConfig, TelemetryConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import AssemblyStatus, Box, Component, InventoryEvent, InventoryEventType
from smartsku_backend.messaging.contracts import BoxDataMessage, IndicatorsCommand, LockerReading, ScreenMode
from smartsku_backend.services.assembly import AssemblyService, AssemblyTracker, StockService
from smartsku_backend.services.errors import ConflictError, NotFoundError
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.locate import ComponentLocator, LocateService
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.specifications import SpecificationLine, SpecificationService
from smartsku_backend.services.telemetry import TelemetryService


class FakePublisher:
    def __init__(self) -> None:
        self.indicators: dict[int, IndicatorsCommand] = {}

    async def send_indicators(self, command: IndicatorsCommand) -> bool:
        self.indicators[command.locker_id] = command
        return True

    def blinking(self) -> list[bool]:
        return [self.indicators[locker_id].blink for locker_id in range(4)]

    def screen(self, locker_id: int) -> tuple[ScreenMode, int | None]:
        command = self.indicators[locker_id]
        return command.screen_mode, command.screen_number


class FakeClock:
    def __init__(self) -> None:
        self.seconds = 0.0

    def now(self) -> float:
        return self.seconds


@dataclass
class Bench:
    session: AsyncSession
    telemetry: TelemetryService
    clock: FakeClock
    publisher: FakePublisher
    specifications: SpecificationService
    assemblies: AssemblyService
    locate: LocateService


class TestAssembly:
    """Box "box": slots 0 and 1 hold screws (2 g each), slot 2 — nuts (5 g), slot 3 — washers (1 g)."""

    PIECE_WEIGHTS: ClassVar[dict[str, float]] = {"s1": 2.0, "s2": 2.0, "n1": 5.0, "w1": 1.0}
    CONFIRM_SECONDS = 3.0

    @pytest.fixture
    async def session(self, tmp_path: Path) -> AsyncIterator[AsyncSession]:
        database = Database(DatabaseConfig(path=tmp_path / "test.db", busy_timeout_seconds=5, echo=False))
        await database.create_schema()
        async with database.session_factory() as session:
            session.add(Box(id="box", hardware_id="hw", online=True))
            names = {"s1": "Шуруп 4x30", "s2": "шуруп  4x30", "n1": "Гайка M6", "w1": "Шайба"}
            for nfc_id, name in names.items():
                session.add(
                    Component(
                        nfc_id=nfc_id,
                        name=name,
                        tags=[],
                        piece_weight=self.PIECE_WEIGHTS[nfc_id],
                        quantity=0,
                        calibrated_at=datetime.now(UTC),
                    )
                )
            await session.commit()
            yield session
        await database.dispose()

    @pytest.fixture
    def clock(self) -> FakeClock:
        return FakeClock()

    @pytest.fixture
    def cache(self) -> LockerRuntimeCache:
        return LockerRuntimeCache()

    @pytest.fixture
    def publisher(self) -> FakePublisher:
        return FakePublisher()

    @pytest.fixture
    def locator(self, clock: FakeClock) -> ComponentLocator:
        return ComponentLocator(LocateConfig(seconds=60), clock)  # type: ignore[arg-type]

    @pytest.fixture
    def telemetry(
        self,
        session: AsyncSession,
        cache: LockerRuntimeCache,
        publisher: FakePublisher,
        clock: FakeClock,
        locator: ComponentLocator,
    ) -> TelemetryService:
        return TelemetryService(
            session,
            cache,
            IndicatorPolicy(),
            publisher,  # type: ignore[arg-type]
            assemblies=AssemblyTracker(session),
            locator=locator,
            config=TelemetryConfig(weight_change_threshold=0.1, confirm_seconds=self.CONFIRM_SECONDS),
            clock=clock,
        )

    @pytest.fixture
    def bench(
        self,
        *,
        session: AsyncSession,
        telemetry: TelemetryService,
        cache: LockerRuntimeCache,
        publisher: FakePublisher,
        clock: FakeClock,
        locator: ComponentLocator,
    ) -> Bench:
        specifications = SpecificationService(session)
        stock = StockService(session)
        assemblies = AssemblyService(session, specifications, stock, AssemblyTracker(session), cache)
        locate = LocateService(locator, stock, cache)
        return Bench(session, telemetry, clock, publisher, specifications, assemblies, locate)

    async def _send(self, bench: Bench, pieces: dict[str, int | None], seconds: float = 0) -> None:
        """The box reports its four slots (in this order) every 0.5 s for this long; None — the cell is pulled out."""
        message = BoxDataMessage(
            box_id="box", lockers=[self._reading(index, *item) for index, item in enumerate(pieces.items())]
        )
        elapsed = 0.0
        while True:
            await bench.telemetry.handle(message)
            if elapsed >= seconds:
                return
            bench.clock.seconds += 0.5
            elapsed += 0.5

    def _reading(self, locker_id: int, nfc_id: str, pieces: int | None) -> LockerReading:
        if pieces is None:
            return LockerReading(
                locker_id=locker_id, nfc_flag=False, weight=0.0, piece_weight=0.0, number_of_pieces=0, slot_ready=True
            )
        piece_weight = self.PIECE_WEIGHTS[nfc_id]
        return LockerReading(
            locker_id=locker_id,
            nfc_flag=True,
            nfc_id=nfc_id,
            weight=pieces * piece_weight,
            piece_weight=piece_weight,
            number_of_pieces=pieces,
            slot_ready=True,
            cell_tared=True,
        )

    async def _hold(self, bench: Bench, **pieces: int | None) -> None:
        """The same reading long enough to reach the journal."""
        await self._send(bench, pieces, self.CONFIRM_SECONDS)

    def _screens(self, bench: Bench) -> list[tuple[ScreenMode, int | None]]:
        return [bench.publisher.screen(locker_id) for locker_id in range(4)]

    async def _table(self, bench: Bench) -> int:
        view = await bench.specifications.create(
            "Стол",
            [SpecificationLine("Шуруп 4x30", 30), SpecificationLine("Гайка M6", 4), SpecificationLine("гайка m6", 1)],
        )
        return view.specification.id

    async def test_same_component_in_several_cells_adds_up(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        table = await self._table(bench)

        one = await bench.assemblies.availability(table, 1)
        assert [(item.component_name, item.required, item.available, item.missing) for item in one.items] == [
            ("Шуруп 4x30", 30, 35, 0),
            ("Гайка M6", 5, 8, 0),
        ]
        assert not (await bench.assemblies.availability(table, 2)).ok
        with pytest.raises(ConflictError, match="Шуруп 4x30: нужно 60, есть 35, не хватает 25"):
            await bench.assemblies.start(table, 2)

    async def test_pulled_out_cell_is_not_available(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        await self._hold(bench, s1=20, s2=None, n1=8, w1=50)
        report = await bench.assemblies.availability(await self._table(bench), 1)
        screws = report.items[0]
        assert (screws.available, screws.missing, screws.elsewhere) == (20, 10, 15)

    async def test_displays_guide_the_picking_and_the_assembly_ends_by_itself(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        view = await bench.assemblies.start(await self._table(bench), 1)
        assert [(pick.pick.nfc_id, pick.pick.quantity) for pick in view.picks] == [("s1", 20), ("s2", 10), ("n1", 5)]

        await self._send(bench, {"s1": 20, "s2": 15, "n1": 8, "w1": 50})
        assert self._screens(bench) == [
            (ScreenMode.TAKE, 20),
            (ScreenMode.TAKE, 10),
            (ScreenMode.TAKE, 5),
            (ScreenMode.OFF, None),
        ]

        # Slot 0 emptied — done, goes dark; slot 1 pulled out keeps its task
        await self._hold(bench, s1=0, s2=None, n1=8, w1=50)
        assert self._screens(bench)[:2] == [(ScreenMode.OFF, None), (ScreenMode.TAKE, 10)]
        # Took 12 of 10 — put 2 back
        await self._hold(bench, s1=0, s2=3, n1=8, w1=50)
        assert bench.publisher.screen(1) == (ScreenMode.PUT, 2)
        await self._hold(bench, s1=0, s2=5, n1=4, w1=50)
        assert self._screens(bench)[1:3] == [(ScreenMode.OFF, None), (ScreenMode.TAKE, 1)]

        await self._hold(bench, s1=0, s2=5, n1=3, w1=50)
        finished = await bench.assemblies.get(view.assembly.id)
        assert finished.assembly.status is AssemblyStatus.COMPLETED
        assert [(pick.taken, pick.remaining) for pick in finished.picks] == [(20, 0), (10, 0), (5, 0)]

        # Back to counting on every slot
        await self._send(bench, {"s1": 0, "s2": 5, "n1": 3, "w1": 50})
        assert self._screens(bench) == [
            (ScreenMode.COUNT, 0),
            (ScreenMode.COUNT, 5),
            (ScreenMode.COUNT, 3),
            (ScreenMode.COUNT, 50),
        ]
        events = await bench.session.scalars(
            select(InventoryEvent).where(InventoryEvent.assembly_id == view.assembly.id).order_by(InventoryEvent.id)
        )
        assert [(event.event_type, event.box_id, event.nfc_id, event.note) for event in events] == [
            (InventoryEventType.ASSEMBLY_STARTED, None, None, "Сборка №1 «Стол»: взять 35 шт из ячеек: 3, боксов: 1"),
            (InventoryEventType.CELL_REMOVED, "box", "s2", None),
            (InventoryEventType.QUANTITY_CHANGED, "box", "s1", None),
            (InventoryEventType.CELL_INSERTED, "box", "s2", None),
            (InventoryEventType.QUANTITY_CHANGED, "box", "s2", None),
            (InventoryEventType.QUANTITY_CHANGED, "box", "n1", None),
            (InventoryEventType.QUANTITY_CHANGED, "box", "n1", None),
            (InventoryEventType.ASSEMBLY_COMPLETED, None, None, "Сборка №1 «Стол» собрана: взято 35 из 35 шт"),
        ]

    async def test_cancel_puts_the_displays_back(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        table = await self._table(bench)
        view = await bench.assemblies.start(table, 1)
        with pytest.raises(ConflictError, match="Уже идёт"):
            await bench.assemblies.start(table, 1)

        await self._hold(bench, s1=12, s2=15, n1=8, w1=50)
        assert bench.publisher.screen(0) == (ScreenMode.TAKE, 12)
        cancelled = await bench.assemblies.cancel(view.assembly.id)
        assert cancelled.assembly.status is AssemblyStatus.CANCELLED
        assert cancelled.picks[0].taken == 8

        await self._send(bench, {"s1": 12, "s2": 15, "n1": 8, "w1": 50})
        assert self._screens(bench) == [
            (ScreenMode.COUNT, 12),
            (ScreenMode.COUNT, 15),
            (ScreenMode.COUNT, 8),
            (ScreenMode.COUNT, 50),
        ]

    async def test_task_follows_a_cell_put_into_another_slot(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=None)
        await bench.assemblies.start(await self._table(bench), 1)
        await self._hold(bench, s1=20, s2=15, n1=None, w1=None)
        # The nuts cell comes back into the free slot 3 with 2 taken, slot 2 stays empty
        await self._send(bench, {"s1": 20, "s2": 15, "w1": None, "n1": 6}, self.CONFIRM_SECONDS)
        assert bench.publisher.screen(3) == (ScreenMode.TAKE, 3)
        assert bench.publisher.screen(2) == (ScreenMode.OFF, None)

    async def test_located_component_blinks_in_all_its_cells_until_the_time_runs_out(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        with pytest.raises(NotFoundError):
            await bench.locate.start("Саморез")

        view = await bench.locate.start("ШУРУП 4x30")
        assert sorted(cell.component.nfc_id for cell in view.cells) == ["s1", "s2"]
        await self._send(bench, {"s1": 20, "s2": 15, "n1": 8, "w1": 50})
        assert bench.publisher.blinking() == [True, True, False, False]
        # Blinking keeps the count on the display
        assert self._screens(bench)[:2] == [(ScreenMode.COUNT, 20), (ScreenMode.COUNT, 15)]

        bench.clock.seconds += 61
        await self._send(bench, {"s1": 20, "s2": 15, "n1": 8, "w1": 50})
        assert bench.publisher.blinking() == [False, False, False, False]
        assert await bench.locate.current() is None

    async def test_stopped_search_stops_blinking(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        await bench.locate.start("Гайка M6")
        await self._send(bench, {"s1": 20, "s2": 15, "n1": 8, "w1": 50})
        assert bench.publisher.blinking() == [False, False, True, False]
        bench.locate.stop()
        await self._send(bench, {"s1": 20, "s2": 15, "n1": 8, "w1": 50})
        assert bench.publisher.blinking() == [False, False, False, False]

    async def test_pulling_out_a_located_cell_ends_the_search(self, bench: Bench) -> None:
        await self._hold(bench, s1=20, s2=15, n1=8, w1=50)
        await bench.locate.start("Шуруп 4x30")
        await self._send(bench, {"s1": 20, "s2": 15, "n1": 8, "w1": 50})
        assert bench.publisher.blinking() == [True, True, False, False]

        # Another cell pulled out does not end it
        await self._send(bench, {"s1": 20, "s2": 15, "n1": None, "w1": 50})
        assert await bench.locate.current() is not None

        await self._send(bench, {"s1": None, "s2": 15, "n1": None, "w1": 50})
        assert await bench.locate.current() is None
        await self._send(bench, {"s1": None, "s2": 15, "n1": None, "w1": 50})
        assert bench.publisher.blinking() == [False, False, False, False]
