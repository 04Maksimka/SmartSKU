import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import ScaleConfig
from smartsku_backend.db.models import Box, LockerState
from smartsku_backend.messaging.contracts import ScaleAction, ScaleCommand, ScaleDoneEvent, ScaleFailedEvent
from smartsku_backend.messaging.publisher import CommandPublisher
from smartsku_backend.services.errors import ConflictError, NotFoundError
from smartsku_backend.services.failure_notes import FailureNotes

logger = logging.getLogger(__name__)


class ScaleResultWaiter:
    """Hands the box's answer to a scale command over to the API request waiting for it."""

    def __init__(self) -> None:
        self._waiting: dict[tuple[str, int], tuple[ScaleAction, asyncio.Future[ScaleDoneEvent | ScaleFailedEvent]]] = {}

    def expect(
        self, box_id: str, locker_id: int, action: ScaleAction
    ) -> asyncio.Future[ScaleDoneEvent | ScaleFailedEvent]:
        if (box_id, locker_id) in self._waiting:
            raise ConflictError(f"Locker {locker_id} of box {box_id} is already measuring")
        future: asyncio.Future[ScaleDoneEvent | ScaleFailedEvent] = asyncio.get_running_loop().create_future()
        self._waiting[(box_id, locker_id)] = (action, future)
        return future

    def resolve(self, event: ScaleDoneEvent | ScaleFailedEvent) -> None:
        waiting = self._waiting.get((event.box_id, event.locker_id))
        if waiting is not None and waiting[0] is event.action and not waiting[1].done():
            waiting[1].set_result(event)

    def discard(self, box_id: str, locker_id: int) -> None:
        self._waiting.pop((box_id, locker_id), None)


class ScaleService:
    """Load cell setup from the dashboard: each action is one measurement the box answers in a few seconds,
    so the request waits for the answer. The box's report is logged by BoxEventService."""

    def __init__(
        self,
        session: AsyncSession,
        publisher: CommandPublisher,
        waiter: ScaleResultWaiter,
        notes: FailureNotes,
        config: ScaleConfig,
    ) -> None:
        self._session = session
        self._publisher = publisher
        self._waiter = waiter
        self._notes = notes
        self._config = config

    async def run(self, box_id: str, locker_id: int, action: ScaleAction, grams: float | None) -> ScaleDoneEvent:
        if action is ScaleAction.REFERENCE and grams is None:
            raise ConflictError("The reference weight in grams is required")
        box = await self._session.get(Box, box_id)
        if box is None:
            raise NotFoundError(f"Box {box_id} not found")
        if not box.online:
            raise ConflictError(f"Box {box_id} is offline")
        if await self._session.get(LockerState, (box_id, locker_id)) is None:
            raise NotFoundError(f"Locker {locker_id} of box {box_id} has not reported yet")
        # Do not hold a read transaction while the box measures
        await self._session.commit()

        future = self._waiter.expect(box_id, locker_id, action)
        try:
            command = ScaleCommand(box_id=box_id, locker_id=locker_id, action=action, grams=grams)
            if not await self._publisher.send_scale(command):
                raise ConflictError("Scale command could not be delivered to the broker")
            try:
                result = await asyncio.wait_for(future, self._config.answer_timeout_seconds)
            except TimeoutError as error:
                raise ConflictError(f"Бокс не ответил за {self._config.answer_timeout_seconds:g} с") from error
        finally:
            self._waiter.discard(box_id, locker_id)

        if isinstance(result, ScaleFailedEvent):
            raise ConflictError(self._notes.text(result.reason))
        return result
