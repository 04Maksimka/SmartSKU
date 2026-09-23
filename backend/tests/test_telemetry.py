from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig, TelemetryConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import Box, Component, InventoryEvent, InventoryEventType, LockerState
from smartsku_backend.messaging.contracts import (
    BoxDataMessage,
    CalibrationProgress,
    CalibrationStep,
    IndicatorsCommand,
    LockerReading,
)
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.telemetry import TelemetryService


class FakePublisher:
    def __init__(self) -> None:
        self.indicators: list[IndicatorsCommand] = []

    async def send_indicators(self, command: IndicatorsCommand) -> bool:
        self.indicators.append(command)
        return True


class FakeClock:
    def __init__(self) -> None:
        self.seconds = 0.0

    def now(self) -> float:
        return self.seconds


class TestTelemetryAccounting:
    CONFIRM_SECONDS = 3.0
    REMOVAL_CONFIRM_SECONDS = 1.0

    @pytest.fixture
    async def session(self, tmp_path: Path) -> AsyncIterator[AsyncSession]:
        database = Database(DatabaseConfig(path=tmp_path / "test.db", busy_timeout_seconds=5, echo=False))
        await database.create_schema()
        async with database.session_factory() as session:
            session.add(Box(id="box", hardware_id="hw"))
            session.add(
                Component(
                    nfc_id="cell", name="Болт", tags=[], piece_weight=2.5, quantity=0, calibrated_at=datetime.now(UTC)
                )
            )
            await session.commit()
            yield session
        await database.dispose()

    @pytest.fixture
    def clock(self) -> FakeClock:
        return FakeClock()

    def _service(self, session: AsyncSession, clock: FakeClock) -> TelemetryService:
        return TelemetryService(
            session,
            LockerRuntimeCache(),
            IndicatorPolicy(),
            FakePublisher(),
            config=TelemetryConfig(
                weight_change_threshold=0.1,
                confirm_seconds=self.CONFIRM_SECONDS,
                removal_confirm_seconds=self.REMOVAL_CONFIRM_SECONDS,
            ),
            clock=clock,
        )

    async def _send(
        self, service: TelemetryService, clock: FakeClock, message: BoxDataMessage, seconds: float = 0.5
    ) -> None:
        """The box repeats the same reading every 0.5 s for this long."""
        elapsed = 0.0
        while True:
            await service.handle(message)
            if elapsed >= seconds:
                return
            clock.seconds += 0.5
            elapsed += 0.5

    async def _hold(self, service: TelemetryService, clock: FakeClock, message: BoxDataMessage) -> None:
        await self._send(service, clock, message, self.CONFIRM_SECONDS)

    def _message(self, weight: float, measurable: bool) -> BoxDataMessage:
        reading = LockerReading(
            locker_id=0,
            nfc_flag=True,
            nfc_id="cell",
            weight=weight,
            piece_weight=2.5,
            number_of_pieces=0,
            slot_ready=True,
            cell_tared=measurable,
        )
        return BoxDataMessage(box_id="box", lockers=[reading])

    def _in_calibration(self) -> BoxDataMessage:
        reading = LockerReading(
            locker_id=0,
            nfc_flag=True,
            nfc_id="cell",
            weight=0.0,
            piece_weight=2.5,
            number_of_pieces=0,
            slot_ready=True,
            cell_tared=True,
            calibration=CalibrationProgress(step=CalibrationStep.INSERT_FILLED, num_of_pieces=20),
        )
        return BoxDataMessage(box_id="box", lockers=[reading])

    def _pulled_out(self) -> BoxDataMessage:
        reading = LockerReading(
            locker_id=0, nfc_flag=False, nfc_id="", weight=0.0, piece_weight=0.0, number_of_pieces=0, slot_ready=True
        )
        return BoxDataMessage(box_id="box", lockers=[reading])

    async def _events(self, session: AsyncSession) -> list[tuple[InventoryEventType, int | None, int | None]]:
        events = await session.scalars(select(InventoryEvent).order_by(InventoryEvent.id))
        return [(event.event_type, event.quantity_before, event.quantity_after) for event in events]

    async def test_untared_cell_logs_presence_but_not_quantity(self, session: AsyncSession, clock: FakeClock) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=0.0, measurable=False))

        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert (state.cell_tared, state.nfc_flag, state.nfc_id, state.quantity) == (False, True, "cell", None)

        await self._hold(service, clock, self._pulled_out())
        assert (state.nfc_flag, state.nfc_id) == (False, None)
        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, None, None),
            (InventoryEventType.CELL_REMOVED, None, None),
        ]

    async def test_tare_starts_accounting_of_an_inserted_cell(self, session: AsyncSession, clock: FakeClock) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=0.0, measurable=False))
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))

        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert (state.cell_tared, state.quantity) == (True, 20)
        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, None, None),
            (InventoryEventType.QUANTITY_CHANGED, None, 20),
        ]

    async def test_tared_cell_inserted_into_ready_slot_is_counted(
        self, session: AsyncSession, clock: FakeClock
    ) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._pulled_out())
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))

        assert await self._events(session) == [(InventoryEventType.CELL_INSERTED, 0, 20)]

    async def test_quantity_is_logged_only_after_it_holds(self, session: AsyncSession, clock: FakeClock) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))
        # Settling after the cell went in, then pouring: every value is shown live but none is logged
        for weight in (55.0, 47.5, 52.5, 60.0, 70.0, 75.0):
            await self._send(service, clock, self._message(weight=weight, measurable=True), seconds=1.0)
        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert state.quantity == 30
        assert await self._events(session) == [(InventoryEventType.CELL_INSERTED, 0, 20)]

        await self._hold(service, clock, self._message(weight=75.0, measurable=True))
        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, 0, 20),
            (InventoryEventType.QUANTITY_CHANGED, 20, 30),
        ]

    async def test_weight_that_comes_back_is_not_logged(self, session: AsyncSession, clock: FakeClock) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))
        await self._send(service, clock, self._message(weight=62.5, measurable=True), seconds=2.0)
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))

        assert await self._events(session) == [(InventoryEventType.CELL_INSERTED, 0, 20)]

    async def test_flickering_tag_of_a_half_pulled_cell_is_not_logged(
        self, session: AsyncSession, clock: FakeClock
    ) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))
        # The tag is at the edge of the field: seen for a moment, while the box is still settling the weight
        for _ in range(5):
            await self._send(service, clock, self._pulled_out(), seconds=0.5)
            await self._send(service, clock, self._message(weight=0.0, measurable=False), seconds=0.5)

        assert await self._events(session) == [(InventoryEventType.CELL_INSERTED, 0, 20)]

    async def test_removal_is_logged_after_a_short_hold(self, session: AsyncSession, clock: FakeClock) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))
        await self._send(service, clock, self._pulled_out(), seconds=0.5)
        assert await self._events(session) == [(InventoryEventType.CELL_INSERTED, 0, 20)]

        await self._send(service, clock, self._pulled_out(), seconds=0.5)
        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, 0, 20),
            (InventoryEventType.CELL_REMOVED, 20, None),
        ]

    async def test_refill_out_of_the_slot_is_one_removal_and_one_insertion(
        self, session: AsyncSession, clock: FakeClock
    ) -> None:
        service = self._service(session, clock)
        await self._hold(service, clock, self._message(weight=50.0, measurable=True))
        await self._send(service, clock, self._pulled_out(), seconds=10.0)
        await self._send(service, clock, self._message(weight=0.0, measurable=False), seconds=1.0)
        await self._hold(service, clock, self._message(weight=100.0, measurable=True))

        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, 0, 20),
            (InventoryEventType.CELL_REMOVED, 20, None),
            (InventoryEventType.CELL_INSERTED, 20, 40),
        ]
        component = await session.get(Component, "cell")
        assert component is not None
        assert component.quantity == 40

    async def test_calibration_step_is_stored_and_quantity_is_not_counted(
        self, session: AsyncSession, clock: FakeClock
    ) -> None:
        service = self._service(session, clock)
        await service.handle(self._in_calibration())

        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert (state.calibration_step, state.calibration_pieces, state.quantity) == ("insert_filled", 20, None)
