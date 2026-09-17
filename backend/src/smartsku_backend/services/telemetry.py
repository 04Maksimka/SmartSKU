import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import TelemetryConfig
from smartsku_backend.db.models import (
    Box,
    Calibration,
    CalibrationStatus,
    Component,
    InventoryEvent,
    InventoryEventType,
    LockerState,
)
from smartsku_backend.messaging.contracts import BoxDataMessage, IndicatorsCommand, LockerReading
from smartsku_backend.messaging.publisher import CommandPublisher
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.runtime_cache import LockerRuntimeCache

logger = logging.getLogger(__name__)


class TelemetryService:
    """Turns periodic box readings into locker state, inventory events, calibration results and indicator commands."""

    def __init__(
        self,
        session: AsyncSession,
        cache: LockerRuntimeCache,
        indicator_policy: IndicatorPolicy,
        publisher: CommandPublisher,
        config: TelemetryConfig,
    ) -> None:
        self._session = session
        self._cache = cache
        self._indicator_policy = indicator_policy
        self._publisher = publisher
        self._config = config

    async def handle(self, message: BoxDataMessage) -> None:
        readings = [
            reading
            for reading in message.lockers
            if self._cache.is_significant(message.box_id, reading, self._config.weight_change_threshold)
        ]
        if not readings:
            return
        if await self._session.get(Box, message.box_id) is None:
            logger.warning("Telemetry from unknown box %s ignored", message.box_id)
            return

        commands = [await self._apply(message.box_id, reading) for reading in readings]
        await self._session.commit()

        for reading in readings:
            self._cache.remember_reading(message.box_id, reading)
        for command in commands:
            if self._cache.indicators_changed(command) and await self._publisher.send_indicators(command):
                self._cache.remember_indicators(command)

    async def _apply(self, box_id: str, reading: LockerReading) -> IndicatorsCommand:
        state = await self._session.get(LockerState, (box_id, reading.locker_id))
        if state is None:
            state = LockerState(
                box_id=box_id, locker_id=reading.locker_id, nfc_flag=False, weight=0.0, reported_piece_weight=0.0
            )
            self._session.add(state)
        # Cell presence comes from NFC and does not depend on the zero or the calibration.
        inserted = reading.nfc_flag and (not state.nfc_flag or state.nfc_id != reading.nfc_id)
        removed = state.nfc_flag and (not reading.nfc_flag or state.nfc_id != reading.nfc_id)
        if not reading.zeroed:
            return await self._apply_unzeroed(state, reading, inserted=inserted, removed=removed)

        if removed:
            removed_component = await self._find_component(state.nfc_id)
            self._log(
                InventoryEventType.CELL_REMOVED,
                state,
                removed_component,
                state.weight,
                before=state.quantity,
                after=None,
            )

        component = await self._find_component(reading.nfc_id) if reading.nfc_flag else None
        previous_quantity = component.quantity if component else None
        # A pull-out/insert faster than the telemetry period is invisible, so calibration is detected by the
        # box reporting a new piece_weight rather than by observing the insertion itself.
        calibrated = False
        if reading.nfc_flag and reading.piece_weight > 0 and reading.piece_weight != state.reported_piece_weight:
            component, calibrated = await self._complete_pending_calibration(box_id, reading, component)
        quantity = component.quantity_for(reading.weight) if component else None

        if inserted:
            state.nfc_id = reading.nfc_id
            self._log(
                InventoryEventType.CELL_INSERTED,
                state,
                component,
                reading.weight,
                before=previous_quantity,
                after=quantity,
            )
        # A slot that just got its zero has no quantity yet, so its first count is logged as a change from "—".
        elif reading.nfc_flag and component is not None and not calibrated and quantity != state.quantity:
            self._log(
                InventoryEventType.QUANTITY_CHANGED,
                state,
                component,
                reading.weight,
                before=state.quantity,
                after=quantity,
            )

        if component is not None:
            component.quantity = quantity
        state.nfc_flag = reading.nfc_flag
        state.nfc_id = reading.nfc_id if reading.nfc_flag else None
        state.weight = reading.weight
        state.reported_piece_weight = reading.piece_weight
        state.quantity = quantity
        state.zeroed = True
        state.updated_at = datetime.now(UTC)
        return self._indicator_policy.build(box_id, reading.locker_id, reading.nfc_flag, quantity)

    async def _apply_unzeroed(
        self, state: LockerState, reading: LockerReading, *, inserted: bool, removed: bool
    ) -> IndicatorsCommand:
        """Without a zero the weight means nothing: log only cell presence, without weight or quantity."""
        if removed:
            self._log(
                InventoryEventType.CELL_REMOVED,
                state,
                await self._find_component(state.nfc_id),
                0.0,
                before=state.quantity,
                after=None,
            )
        if inserted:
            state.nfc_id = reading.nfc_id
            self._log(
                InventoryEventType.CELL_INSERTED,
                state,
                await self._find_component(reading.nfc_id),
                0.0,
                before=None,
                after=None,
            )
        state.nfc_flag = reading.nfc_flag
        state.nfc_id = reading.nfc_id if reading.nfc_flag else None
        state.weight = 0.0
        state.reported_piece_weight = reading.piece_weight
        state.quantity = None
        state.zeroed = False
        state.updated_at = datetime.now(UTC)
        return self._indicator_policy.build(state.box_id, state.locker_id, reading.nfc_flag, None)

    async def _complete_pending_calibration(
        self, box_id: str, reading: LockerReading, component: Component | None
    ) -> tuple[Component | None, bool]:
        """The box recalculates piece_weight when a cell is re-inserted after a calibration command."""
        if reading.nfc_id is None:
            return component, False
        calibration = await self._session.scalar(
            select(Calibration)
            .where(
                Calibration.box_id == box_id,
                Calibration.locker_id == reading.locker_id,
                Calibration.status == CalibrationStatus.PENDING,
            )
            .order_by(Calibration.created_at.desc())
        )
        if calibration is None:
            return component, False

        now = datetime.now(UTC)
        if component is None:
            component = Component(nfc_id=reading.nfc_id)
            self._session.add(component)
        component.name = calibration.name
        component.tags = list(calibration.tags)
        component.piece_weight = reading.piece_weight
        component.calibrated_at = now

        calibration.status = CalibrationStatus.COMPLETED
        calibration.nfc_id = reading.nfc_id
        calibration.piece_weight = reading.piece_weight
        calibration.completed_at = now

        self._session.add(
            InventoryEvent(
                event_type=InventoryEventType.CALIBRATED,
                box_id=box_id,
                locker_id=reading.locker_id,
                nfc_id=reading.nfc_id,
                component_name=component.name,
                weight=reading.weight,
                quantity_before=None,
                quantity_after=component.quantity_for(reading.weight),
            )
        )
        logger.info(
            "Calibration %s completed: cell %s holds '%s', piece weight %.3f g",
            calibration.id,
            reading.nfc_id,
            component.name,
            reading.piece_weight,
        )
        return component, True

    async def _find_component(self, nfc_id: str | None) -> Component | None:
        return await self._session.get(Component, nfc_id) if nfc_id else None

    def _log(
        self,
        event_type: InventoryEventType,
        state: LockerState,
        component: Component | None,
        weight: float,
        *,
        before: int | None,
        after: int | None,
    ) -> None:
        self._session.add(
            InventoryEvent(
                event_type=event_type,
                box_id=state.box_id,
                locker_id=state.locker_id,
                nfc_id=state.nfc_id,
                component_name=component.name if component else None,
                weight=weight,
                quantity_before=before,
                quantity_after=after,
            )
        )
