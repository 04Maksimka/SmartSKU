from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Box, LockerState
from smartsku_backend.messaging.contracts import TareCommand
from smartsku_backend.messaging.publisher import CommandPublisher
from smartsku_backend.services.errors import ConflictError, NotFoundError


class TareService:
    def __init__(self, session: AsyncSession, publisher: CommandPublisher) -> None:
        self._session = session
        self._publisher = publisher

    async def send(self, box_id: str, locker_id: int) -> None:
        box = await self._session.get(Box, box_id)
        if box is None:
            raise NotFoundError(f"Box {box_id} not found")
        if not box.online:
            raise ConflictError(f"Box {box_id} is offline")
        state = await self._session.get(LockerState, (box_id, locker_id))
        # The current physical firmware has one slot. Before its first tare there is no locker state yet.
        if state is None and locker_id != 0:
            raise NotFoundError(f"Locker {locker_id} of box {box_id} has not reported yet")
        if state is not None and not state.nfc_flag:
            raise ConflictError("Insert the empty cell before taring")
        if not await self._publisher.send_tare(TareCommand(box_id=box_id, locker_id=locker_id)):
            raise ConflictError("Tare command could not be delivered to the broker")
