import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import TelemetryConfig
from smartsku_backend.db.models import Box, Component, InventoryEvent, InventoryEventType, LockerState
from smartsku_backend.messaging.contracts import BoxDataMessage, IndicatorsCommand, LockerReading
from smartsku_backend.messaging.publisher import CommandPublisher
from smartsku_backend.services.clock import MonotonicClock
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.runtime_cache import LockerRuntimeCache, SlotObservation

logger = logging.getLogger(__name__)


class TelemetryService:
    """Turns periodic box readings into locker state, inventory events and indicator commands.

    The live state (dashboard, displays) follows every reading. The inventory journal records only what held for
    telemetry.confirm_seconds: a half-pulled cell whose tag flickers or a weight still settling after the cell went
    in does not produce records. Results of load cell setup and calibrations come as separate box events, see
    BoxEventService.
    """

    def __init__(
        self,
        session: AsyncSession,
        cache: LockerRuntimeCache,
        indicator_policy: IndicatorPolicy,
        publisher: CommandPublisher,
        *,
        config: TelemetryConfig,
        clock: MonotonicClock,
    ) -> None:
        self._session = session
        self._cache = cache
        self._indicator_policy = indicator_policy
        self._publisher = publisher
        self._config = config
        self._clock = clock

    async def handle(self, message: BoxDataMessage) -> None:
        box_id = message.box_id
        now = self._clock.now()
        readings = [
            reading
            for reading in message.lockers
            if self._cache.is_significant(box_id, reading, self._config.weight_change_threshold)
        ]
        confirmable = any(
            self._cache.has_confirmed(box_id, reading.locker_id, now, self._config.confirm_seconds)
            for reading in message.lockers
        )
        if not readings and not confirmable:
            return
        if await self._session.get(Box, box_id) is None:
            logger.warning("Telemetry from unknown box %s ignored", box_id)
            return

        commands = [await self._apply(box_id, reading, now) for reading in readings]
        for reading in message.lockers:
            confirmed = self._cache.take_confirmed(box_id, reading.locker_id, now, self._config.confirm_seconds)
            if confirmed is not None:
                await self._record(box_id, reading.locker_id, confirmed)
        await self._session.commit()

        for reading in readings:
            self._cache.remember_reading(box_id, reading)
        for command in commands:
            if self._cache.indicators_changed(command) and await self._publisher.send_indicators(command):
                self._cache.remember_indicators(command)

    async def _apply(self, box_id: str, reading: LockerReading, now: float) -> IndicatorsCommand:
        state = await self._session.get(LockerState, (box_id, reading.locker_id))
        if state is None:
            state = LockerState(box_id=box_id, locker_id=reading.locker_id, nfc_flag=False, weight=0.0)
            self._session.add(state)
        self._store_status(state, reading)
        # Cell presence comes from NFC and does not depend on the slot setup, the tare or the calibration.
        nfc_id = reading.nfc_id if reading.nfc_flag else None
        component = await self._find_component(nfc_id)
        measurable = reading.measurable and component is not None
        quantity = component.quantity_for(reading.weight) if measurable and component else None

        state.nfc_flag = reading.nfc_flag
        state.nfc_id = nfc_id
        state.weight = reading.weight if reading.measurable else 0.0
        state.quantity = quantity
        state.updated_at = datetime.now(UTC)
        self._observe(state, SlotObservation(nfc_id, quantity, state.weight), now)
        return self._indicator_policy.build(box_id, reading.locker_id, reading.nfc_flag, quantity)

    def _observe(self, state: LockerState, observation: SlotObservation, now: float) -> None:
        """Start waiting for a reading the journal does not have yet; a return to the journal's view drops it."""
        # No quantity (not counted yet, a calibration moves the cell) says nothing about the contents
        quantity_news = observation.quantity is not None and observation.quantity != state.logged_quantity
        if observation.nfc_id != state.logged_nfc_id or quantity_news:
            self._cache.hold(state.box_id, state.locker_id, observation, now)
        else:
            self._cache.drop_pending(state.box_id, state.locker_id)

    async def _record(self, box_id: str, locker_id: int, observation: SlotObservation) -> None:
        state = await self._session.get(LockerState, (box_id, locker_id))
        if state is None:
            return
        if state.logged_nfc_id is not None and observation.nfc_id != state.logged_nfc_id:
            self._log(
                InventoryEventType.CELL_REMOVED,
                state,
                state.logged_nfc_id,
                await self._find_component(state.logged_nfc_id),
                0.0,
                before=state.logged_quantity,
                after=None,
            )
            state.logged_nfc_id = None
            state.logged_quantity = None
        if observation.nfc_id is None:
            return

        component = await self._find_component(observation.nfc_id)
        if state.logged_nfc_id is None:
            # "Took the cell away with 20 pieces, brought it back with 3" is one record: before is what it left with
            self._log(
                InventoryEventType.CELL_INSERTED,
                state,
                observation.nfc_id,
                component,
                observation.weight,
                before=component.quantity if component and observation.quantity is not None else None,
                after=observation.quantity,
            )
            state.logged_nfc_id = observation.nfc_id
        elif observation.quantity is not None and observation.quantity != state.logged_quantity:
            # A cell that just became measurable (tared, slot set up) has no quantity yet: logged as a change from "—"
            self._log(
                InventoryEventType.QUANTITY_CHANGED,
                state,
                observation.nfc_id,
                component,
                observation.weight,
                before=state.logged_quantity,
                after=observation.quantity,
            )
        else:
            return
        state.logged_quantity = observation.quantity
        if component is not None and observation.quantity is not None:
            component.quantity = observation.quantity

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
        nfc_id: str,
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
                nfc_id=nfc_id,
                component_name=component.name if component else None,
                weight=weight,
                quantity_before=before,
                quantity_after=after,
            )
        )
