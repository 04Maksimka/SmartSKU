from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import Box, InventoryEvent, InventoryEventType, LockerState
from smartsku_backend.messaging.contracts import BoxEvent
from smartsku_backend.services.box_events import BoxEventService


class TestBoxEvents:
    ADAPTER: TypeAdapter[BoxEvent] = TypeAdapter(BoxEvent)

    @pytest.fixture
    async def session(self, tmp_path: Path) -> AsyncIterator[AsyncSession]:
        database = Database(DatabaseConfig(path=tmp_path / "test.db", busy_timeout_seconds=5, echo=False))
        await database.create_schema()
        async with database.session_factory() as session:
            session.add(Box(id="box", hardware_id="hw"))
            session.add(LockerState(box_id="box", locker_id=0, nfc_flag=True, nfc_id="cell", weight=0.0))
            await session.commit()
            yield session
        await database.dispose()

    async def _logged(self, session: AsyncSession) -> list[InventoryEvent]:
        return list(await session.scalars(select(InventoryEvent)))

    async def test_tare_done_is_logged_with_the_new_zero(self, session: AsyncSession) -> None:
        payload = '{"event":"tare_done","box_id":"box","locker_id":0,"nfc_id":"cell","tare":212169.5}'
        await BoxEventService(session).handle(self.ADAPTER.validate_json(payload))

        [event] = await self._logged(session)
        assert (event.event_type, event.nfc_id, event.weight) == (InventoryEventType.TARED, "cell", 212169.5)

    async def test_tare_failure_is_logged_with_a_reason(self, session: AsyncSession) -> None:
        payload = '{"event":"tare_failed","box_id":"box","locker_id":0,"reason":"no_cell"}'
        await BoxEventService(session).handle(self.ADAPTER.validate_json(payload))

        [event] = await self._logged(session)
        assert (event.event_type, event.note) == (InventoryEventType.TARE_FAILED, "Ячейка не вставлена")

    async def test_event_from_unknown_box_is_ignored(self, session: AsyncSession) -> None:
        payload = '{"event":"tare_done","box_id":"other","locker_id":0,"tare":1}'
        await BoxEventService(session).handle(self.ADAPTER.validate_json(payload))
        assert await self._logged(session) == []
