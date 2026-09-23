import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import TelemetryConfig
from smartsku_backend.db.models import Box, Component, InventoryEvent, InventoryEventType, LockerState
from smartsku_backend.messaging.contracts import BoxDataMessage, IndicatorsCommand, LockerReading
from smartsku_backend.messaging.publisher import CommandPublisher
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.runtime_cache import LockerRuntimeCache

logger = logging.getLogger(__name__)


class TelemetryService:
    """Turns periodic box readings into locker state, inventory events and indicator commands.

    Results of load cell setup and calibrations come as separate box events, see BoxEventService.
    """

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
            state = LockerState(box_id=box_id, locker_id=reading.locker_id, nfc_flag=False, weight=0.0)
            self._session.add(state)
        # Cell presence comes from NFC and does not depend on the slot setup, the tare or the calibration.
        inserted = reading.nfc_flag and (not state.nfc_flag or state.nfc_id != reading.nfc_id)
        removed = state.nfc_flag and (not reading.nfc_flag or state.nfc_id != reading.nfc_id)
        self._store_status(state, reading)
        if not reading.measurable:
            return await self._apply_unmeasurable(state, reading, inserted=inserted, removed=removed)

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

        component = await self._find_component(reading.nfc_id)
        previous_quantity = component.quantity if component else None
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
        # A cell that just became measurable (tared, slot set up) has no quantity yet: logged as a change from "—".
        elif component is not None and quantity != state.quantity:
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
        state.nfc_id = reading.nfc_id
        state.weight = reading.weight
        state.quantity = quantity
        state.updated_at = datetime.now(UTC)
        return self._indicator_policy.build(box_id, reading.locker_id, reading.nfc_flag, quantity)

    async def _apply_unmeasurable(
        self, state: LockerState, reading: LockerReading, *, inserted: bool, removed: bool
    ) -> IndicatorsCommand:
        """The weight means nothing yet (or a calibration moves the cell): log only cell presence."""
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
        state.quantity = None
        state.updated_at = datetime.now(UTC)
        return self._indicator_policy.build(state.box_id, state.locker_id, reading.nfc_flag, None)

    def _store_status(self, state: LockerState, reading: LockerReading) -> None:
        state.slot_ready = reading.slot_ready
        state.cell_tared = reading.nfc_flag and reading.cell_tared
        state.tag_error = reading.nfc_flag and reading.tag_error
        calibration = reading.calibration
        state.calibration_step = calibration.step.value if calibration else None
        state.calibration_pieces = calibration.num_of_pieces if calibration else 0

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
