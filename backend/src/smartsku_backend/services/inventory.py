from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Box, Component, InventoryEvent, LockerState
from smartsku_backend.services.errors import NotFoundError
from smartsku_backend.services.runtime_cache import LockerRuntimeCache


class InventoryQueryService:
    """Read side for the frontend: boxes, lockers, components and the event log."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def boxes(self) -> list[Box]:
        return list(await self._session.scalars(select(Box).order_by(Box.created_at)))

    async def lockers(self, box_id: str | None, free: bool | None) -> list[tuple[LockerState, Component | None]]:
        query = (
            select(LockerState, Component)
            .outerjoin(Component, Component.nfc_id == LockerState.nfc_id)
            .order_by(LockerState.box_id, LockerState.locker_id)
        )
        if box_id is not None:
            query = query.where(LockerState.box_id == box_id)
        if free is True:
            query = query.where(Component.nfc_id.is_(None))
        elif free is False:
            query = query.where(Component.nfc_id.is_not(None))
        result = await self._session.execute(query)
        return [(state, component) for state, component in result.tuples()]

    async def components(self, search: str | None, tag: str | None) -> list[Component]:
        query = select(Component).order_by(Component.name)
        if search:
            query = query.where(Component.name.ilike(f"%{search}%"))
        components = list(await self._session.scalars(query))
        # Tags are a JSON column in SQLite; filtering in Python is fine at prototype scale.
        return [component for component in components if tag in component.tags] if tag else components

    async def events(self, box_id: str | None, nfc_id: str | None, limit: int) -> list[InventoryEvent]:
        query = select(InventoryEvent).order_by(InventoryEvent.id.desc()).limit(limit)
        if box_id is not None:
            query = query.where(InventoryEvent.box_id == box_id)
        if nfc_id is not None:
            query = query.where(InventoryEvent.nfc_id == nfc_id)
        return list(await self._session.scalars(query))


class ComponentService:
    def __init__(self, session: AsyncSession, cache: LockerRuntimeCache) -> None:
        self._session = session
        self._cache = cache

    async def release(self, nfc_id: str) -> None:
        """Forget what a cell holds so it can be calibrated for another component."""
        result = await self._session.execute(delete(Component).where(Component.nfc_id == nfc_id))
        if result.rowcount == 0:
            raise NotFoundError(f"Component in cell {nfc_id} not found")
        states = await self._session.scalars(select(LockerState).where(LockerState.nfc_id == nfc_id))
        for state in states:
            state.quantity = None
            state.logged_quantity = None
            # Next telemetry from this box is reprocessed, which switches the released cell's indicators off.
            self._cache.forget_box(state.box_id)
        await self._session.commit()

    async def set_low_stock(self, nfc_id: str, low_stock: int | None) -> Component:
        """Change or drop the level below which the dashboard warns that the cell is running low."""
        component = await self._session.get(Component, nfc_id)
        if component is None:
            raise NotFoundError(f"Component in cell {nfc_id} not found")
        component.low_stock = low_stock
        await self._session.commit()
        return component
