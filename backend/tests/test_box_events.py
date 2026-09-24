from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import (
    Box,
    Calibration,
    CalibrationStatus,
    Component,
    InventoryEvent,
    InventoryEventType,
    LockerState,
)
from smartsku_backend.messaging.contracts import BoxEvent, ScaleAction, ScaleDoneEvent, ScaleFailedEvent
from smartsku_backend.services.box_events import BoxEventService
from smartsku_backend.services.failure_notes import FailureNotes
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.scale import ScaleResultWaiter


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

    def _service(self, session: AsyncSession) -> BoxEventService:
        return BoxEventService(session, LockerRuntimeCache(), ScaleResultWaiter(), FailureNotes())

    async def _calibration(self, session: AsyncSession, low_stock: int | None = None) -> Calibration:
        calibration = Calibration(
            box_id="box", locker_id=0, name="Болт", tags=["м3"], num_of_pieces=20, low_stock=low_stock
        )
        session.add(calibration)
        await session.commit()
        return calibration

    async def test_cell_tare_is_logged_with_the_cell_weight(self, session: AsyncSession) -> None:
        payload = (
            '{"event":"scale_done","box_id":"box","locker_id":0,"action":"cell_tare","value":41.5,"nfc_id":"cell"}'
        )
        await self._service(session).handle(self.ADAPTER.validate_json(payload))

        [event] = await self._logged(session)
        assert (event.event_type, event.nfc_id, event.weight) == (InventoryEventType.CELL_TARED, "cell", 41.5)

    async def test_scale_failure_is_logged_with_a_reason(self, session: AsyncSession) -> None:
        payload = '{"event":"scale_failed","box_id":"box","locker_id":0,"action":"zero","reason":"load_cell_failed"}'
        await self._service(session).handle(self.ADAPTER.validate_json(payload))

        [event] = await self._logged(session)
        assert (event.event_type, event.note) == (InventoryEventType.SCALE_FAILED, "Ноль: Тензодатчик не отвечает")

    async def test_scale_answer_reaches_the_waiting_request(self, session: AsyncSession) -> None:
        waiter = ScaleResultWaiter()
        future = waiter.expect("box", 0, ScaleAction.REFERENCE)
        service = BoxEventService(session, LockerRuntimeCache(), waiter, FailureNotes())
        payload = '{"event":"scale_done","box_id":"box","locker_id":0,"action":"reference","value":-213.4}'
        await service.handle(self.ADAPTER.validate_json(payload))

        assert future.result() == ScaleDoneEvent(
            event="scale_done", box_id="box", locker_id=0, action=ScaleAction.REFERENCE, value=-213.4
        )
        [event] = await self._logged(session)
        assert event.event_type is InventoryEventType.SLOT_SCALED

    async def test_answer_to_another_action_does_not_resolve_the_request(self, session: AsyncSession) -> None:
        waiter = ScaleResultWaiter()
        future = waiter.expect("box", 0, ScaleAction.ZERO)
        waiter.resolve(
            ScaleFailedEvent(event="scale_failed", box_id="box", locker_id=0, action=ScaleAction.CELL_TARE, reason="x")
        )
        assert not future.done()

    async def test_calibration_done_creates_the_component(self, session: AsyncSession) -> None:
        calibration = await self._calibration(session)
        payload = (
            '{"event":"calibration_done","box_id":"box","locker_id":0,"nfc_id":"cell","piece_weight":2.5,"weight":50}'
        )
        await self._service(session).handle(self.ADAPTER.validate_json(payload))

        component = await session.get(Component, "cell")
        assert component is not None
        assert (component.name, component.piece_weight, component.quantity) == ("Болт", 2.5, 20)
        assert (calibration.status, calibration.nfc_id) == (CalibrationStatus.COMPLETED, "cell")
        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert state.quantity == 20
        [event] = await self._logged(session)
        assert (event.event_type, event.quantity_after) == (InventoryEventType.CALIBRATED, 20)

    async def test_low_stock_level_goes_to_the_component(self, session: AsyncSession) -> None:
        await self._calibration(session, low_stock=25)
        payload = (
            '{"event":"calibration_done","box_id":"box","locker_id":0,"nfc_id":"cell","piece_weight":2.5,"weight":50}'
        )
        await self._service(session).handle(self.ADAPTER.validate_json(payload))

        component = await session.get(Component, "cell")
        assert component is not None
        assert (component.low_stock, component.running_low) == (25, True)
        component.quantity = 25
        assert not component.running_low

    async def test_calibration_failure_cancels_the_request(self, session: AsyncSession) -> None:
        calibration = await self._calibration(session)
        payload = '{"event":"calibration_failed","box_id":"box","locker_id":0,"reason":"tag_write_failed"}'
        await self._service(session).handle(self.ADAPTER.validate_json(payload))

        assert calibration.status is CalibrationStatus.CANCELLED
        [event] = await self._logged(session)
        assert event.event_type is InventoryEventType.CALIBRATION_FAILED

    async def test_event_from_unknown_box_is_ignored(self, session: AsyncSession) -> None:
        payload = '{"event":"scale_done","box_id":"other","locker_id":0,"action":"zero","value":1}'
        await self._service(session).handle(self.ADAPTER.validate_json(payload))
        assert await self._logged(session) == []
