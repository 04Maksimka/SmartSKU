import logging
from typing import ClassVar

from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Box, Component, InventoryEvent, InventoryEventType, LockerState
from smartsku_backend.messaging.contracts import BoxEvent, TareDoneEvent

logger = logging.getLogger(__name__)


class BoxEventService:
    """One-off reports from a box (results of service commands) that go to the event log."""

    FAILURE_NOTES: ClassVar[dict[str, str]] = {
        "no_cell": "Ячейка не вставлена",
        "load_cell_failed": "Тензодатчик не отвечает",
    }

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def handle(self, event: BoxEvent) -> None:
        if await self._session.get(Box, event.box_id) is None:
            logger.warning("Event from unknown box %s ignored", event.box_id)
            return
        state = await self._session.get(LockerState, (event.box_id, event.locker_id))
        nfc_id = state.nfc_id if state else None
        if isinstance(event, TareDoneEvent):
            nfc_id = event.nfc_id or nfc_id
            component = await self._session.get(Component, nfc_id) if nfc_id else None
            self._session.add(
                InventoryEvent(
                    event_type=InventoryEventType.TARED,
                    box_id=event.box_id,
                    locker_id=event.locker_id,
                    nfc_id=nfc_id,
                    component_name=component.name if component else None,
                    weight=event.tare,
                    quantity_before=None,
                    quantity_after=None,
                )
            )
            logger.info("Box %s locker %s zero set to %.1f", event.box_id, event.locker_id, event.tare)
        else:
            self._session.add(
                InventoryEvent(
                    event_type=InventoryEventType.TARE_FAILED,
                    box_id=event.box_id,
                    locker_id=event.locker_id,
                    nfc_id=nfc_id,
                    component_name=None,
                    weight=0.0,
                    quantity_before=None,
                    quantity_after=None,
                    note=self.FAILURE_NOTES.get(event.reason, event.reason),
                )
            )
            logger.warning("Box %s locker %s refused to set zero: %s", event.box_id, event.locker_id, event.reason)
        await self._session.commit()
