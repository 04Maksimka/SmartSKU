import logging
from datetime import UTC, datetime
from typing import ClassVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import (
    Box,
    Calibration,
    CalibrationStatus,
    Component,
    InventoryEvent,
    InventoryEventType,
    LockerState,
)
from smartsku_backend.messaging.contracts import (
    BoxEvent,
    CalibrationDoneEvent,
    CalibrationFailedEvent,
    ScaleAction,
    ScaleDoneEvent,
    ScaleFailedEvent,
)
from smartsku_backend.services.failure_notes import FailureNotes
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.scale import ScaleResultWaiter

logger = logging.getLogger(__name__)


class BoxEventService:
    """Reports of the box: load cell setup (also handed to the waiting API request) and calibrations."""

    SCALE_LABELS: ClassVar[dict[ScaleAction, str]] = {
        ScaleAction.ZERO: "Ноль",
        ScaleAction.REFERENCE: "Гиря",
        ScaleAction.CELL_TARE: "Тара ячейки",
    }

    def __init__(
        self, session: AsyncSession, cache: LockerRuntimeCache, waiter: ScaleResultWaiter, notes: FailureNotes
    ) -> None:
        self._session = session
        self._cache = cache
        self._waiter = waiter
        self._notes = notes

    async def handle(self, event: BoxEvent) -> None:
        if await self._session.get(Box, event.box_id) is None:
            logger.warning("Event from unknown box %s ignored", event.box_id)
            return
        if isinstance(event, ScaleDoneEvent):
            await self._scaled(event)
        elif isinstance(event, ScaleFailedEvent):
            await self._scale_failed(event)
        elif isinstance(event, CalibrationDoneEvent):
            await self._calibrated(event)
        else:
            await self._calibration_failed(event)
        await self._session.commit()
        # The cell's weight and count change meaning: reprocess the next telemetry and resend the indicators
        self._cache.forget_box(event.box_id)
        if isinstance(event, ScaleDoneEvent | ScaleFailedEvent):
            self._waiter.resolve(event)

    async def _scaled(self, event: ScaleDoneEvent) -> None:
        if event.action is ScaleAction.CELL_TARE:
            component = await self._session.get(Component, event.nfc_id) if event.nfc_id else None
            self._log(
                InventoryEventType.CELL_TARED,
                event.box_id,
                event.locker_id,
                nfc_id=event.nfc_id,
                component=component,
                weight=event.value,
            )
        elif event.action is ScaleAction.REFERENCE:
            self._log(
                InventoryEventType.SLOT_SCALED,
                event.box_id,
                event.locker_id,
                nfc_id=None,
                component=None,
                weight=0.0,
                note=f"1 г = {event.value:g} отсчётов датчика",
            )
        else:
            self._log(
                InventoryEventType.SLOT_ZEROED, event.box_id, event.locker_id, nfc_id=None, component=None, weight=0.0
            )
        logger.info("Box %s locker %s: %s = %.2f", event.box_id, event.locker_id, event.action.value, event.value)

    async def _calibrated(self, event: CalibrationDoneEvent) -> None:
        calibration = await self._pending_calibration(event.box_id, event.locker_id)
        component = await self._session.get(Component, event.nfc_id)
        now = datetime.now(UTC)
        if calibration is not None:
            if component is None:
                component = Component(nfc_id=event.nfc_id)
                self._session.add(component)
            component.name = calibration.name
            component.tags = list(calibration.tags)
            component.low_stock = calibration.low_stock
            calibration.status = CalibrationStatus.COMPLETED
            calibration.nfc_id = event.nfc_id
            calibration.piece_weight = event.piece_weight
            calibration.completed_at = now
        elif component is None:
            # Calibrated from the service console: the box knows the piece weight, the backend has no name for it
            logger.warning("Box %s locker %s calibrated without a request, ignored", event.box_id, event.locker_id)
            return
        component.piece_weight = event.piece_weight
        component.calibrated_at = now
        component.quantity = component.quantity_for(event.weight)
        state = await self._session.get(LockerState, (event.box_id, event.locker_id))
        if state is not None:
            # Already logged as the calibration result, the next telemetry must not log it again as a change
            state.quantity = component.quantity
            state.logged_quantity = component.quantity
        self._log(
            InventoryEventType.CALIBRATED,
            event.box_id,
            event.locker_id,
            nfc_id=event.nfc_id,
            component=component,
            weight=event.weight,
            quantity_after=component.quantity,
        )
        logger.info(
            "Box %s locker %s: cell %s holds '%s', piece weight %.2f",
            event.box_id,
            event.locker_id,
            event.nfc_id,
            component.name,
            event.piece_weight,
        )

    async def _scale_failed(self, event: ScaleFailedEvent) -> None:
        note = f"{self.SCALE_LABELS[event.action]}: {self._notes.text(event.reason)}"
        state = await self._session.get(LockerState, (event.box_id, event.locker_id))
        nfc_id = state.nfc_id if state and state.nfc_flag else None
        self._log(
            InventoryEventType.SCALE_FAILED,
            event.box_id,
            event.locker_id,
            nfc_id=nfc_id,
            component=None,
            weight=0.0,
            note=note,
        )
        logger.warning("Box %s locker %s: %s failed: %s", event.box_id, event.locker_id, event.action, event.reason)

    async def _calibration_failed(self, event: CalibrationFailedEvent) -> None:
        state = await self._session.get(LockerState, (event.box_id, event.locker_id))
        nfc_id = state.nfc_id if state else None
        calibration = await self._pending_calibration(event.box_id, event.locker_id)
        if calibration is not None:
            calibration.status = CalibrationStatus.CANCELLED
        self._log(
            InventoryEventType.CALIBRATION_FAILED,
            event.box_id,
            event.locker_id,
            nfc_id=nfc_id,
            component=None,
            weight=0.0,
            note=self._notes.text(event.reason),
        )
        logger.warning("Box %s locker %s: calibration failed: %s", event.box_id, event.locker_id, event.reason)

    async def _pending_calibration(self, box_id: str, locker_id: int) -> Calibration | None:
        return await self._session.scalar(
            select(Calibration)
            .where(
                Calibration.box_id == box_id,
                Calibration.locker_id == locker_id,
                Calibration.status == CalibrationStatus.PENDING,
            )
            .order_by(Calibration.created_at.desc())
        )

    def _log(
        self,
        event_type: InventoryEventType,
        box_id: str,
        locker_id: int,
        *,
        nfc_id: str | None,
        component: Component | None,
        weight: float,
        quantity_after: int | None = None,
        note: str | None = None,
    ) -> None:
        self._session.add(
            InventoryEvent(
                event_type=event_type,
                box_id=box_id,
                locker_id=locker_id,
                nfc_id=nfc_id,
                component_name=component.name if component else None,
                weight=weight,
                quantity_before=None,
                quantity_after=quantity_after,
                note=note,
            )
        )
