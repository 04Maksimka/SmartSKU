from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig, TelemetryConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import Box, Component, InventoryEvent, InventoryEventType, LockerState
from smartsku_backend.messaging.contracts import BoxDataMessage, IndicatorsCommand, LockerReading
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.telemetry import TelemetryService


class FakePublisher:
    def __init__(self) -> None:
        self.indicators: list[IndicatorsCommand] = []

    async def send_indicators(self, command: IndicatorsCommand) -> bool:
        self.indicators.append(command)
        return True


class TestTelemetryWithoutZero:
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

    def _service(self, session: AsyncSession) -> TelemetryService:
        return TelemetryService(
            session,
            LockerRuntimeCache(),
            IndicatorPolicy(),
            FakePublisher(),
            TelemetryConfig(weight_change_threshold=0.1),
        )

    def _message(self, weight: float, zeroed: bool) -> BoxDataMessage:
        reading = LockerReading(
            locker_id=0,
            nfc_flag=True,
            nfc_id="cell",
            weight=weight,
            piece_weight=2.5,
            number_of_pieces=0,
            zeroed=zeroed,
        )
        return BoxDataMessage(box_id="box", lockers=[reading])

    def _pulled_out(self, zeroed: bool) -> BoxDataMessage:
        reading = LockerReading(
            locker_id=0, nfc_flag=False, nfc_id="", weight=0.0, piece_weight=0.0, number_of_pieces=0, zeroed=zeroed
        )
        return BoxDataMessage(box_id="box", lockers=[reading])

    async def _events(self, session: AsyncSession) -> list[tuple[InventoryEventType, int | None, int | None]]:
        events = await session.scalars(select(InventoryEvent).order_by(InventoryEvent.id))
        return [(event.event_type, event.quantity_before, event.quantity_after) for event in events]

    async def test_unzeroed_slot_logs_presence_but_not_quantity(self, session: AsyncSession) -> None:
        service = self._service(session)
        await service.handle(self._message(weight=0.0, zeroed=False))

        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert (state.zeroed, state.nfc_flag, state.nfc_id, state.quantity) == (False, True, "cell", None)

        await service.handle(self._pulled_out(zeroed=False))
        assert (state.nfc_flag, state.nfc_id) == (False, None)
        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, None, None),
            (InventoryEventType.CELL_REMOVED, None, None),
        ]

    async def test_zero_starts_accounting_of_an_inserted_cell(self, session: AsyncSession) -> None:
        service = self._service(session)
        await service.handle(self._message(weight=0.0, zeroed=False))
        await service.handle(self._message(weight=50.0, zeroed=True))

        state = await session.get(LockerState, ("box", 0))
        assert state is not None
        assert (state.zeroed, state.quantity) == (True, 20)
        assert await self._events(session) == [
            (InventoryEventType.CELL_INSERTED, None, None),
            (InventoryEventType.QUANTITY_CHANGED, None, 20),
        ]

    async def test_cell_inserted_into_zeroed_slot_is_counted(self, session: AsyncSession) -> None:
        service = self._service(session)
        await service.handle(self._pulled_out(zeroed=True))
        await service.handle(self._message(weight=50.0, zeroed=True))

        assert await self._events(session) == [(InventoryEventType.CELL_INSERTED, 0, 20)]
