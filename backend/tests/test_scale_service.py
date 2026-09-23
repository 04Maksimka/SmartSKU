from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig, ScaleConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import Box, LockerState
from smartsku_backend.messaging.contracts import ScaleAction, ScaleCommand, ScaleDoneEvent, ScaleFailedEvent
from smartsku_backend.services.errors import ConflictError
from smartsku_backend.services.failure_notes import FailureNotes
from smartsku_backend.services.scale import ScaleResultWaiter, ScaleService


class AnsweringPublisher:
    """Plays the box: answers every scale command right away through the waiter."""

    def __init__(self, waiter: ScaleResultWaiter, reason: str | None) -> None:
        self._waiter = waiter
        self._reason = reason
        self.commands: list[ScaleCommand] = []

    async def send_scale(self, command: ScaleCommand) -> bool:
        self.commands.append(command)
        if self._reason is None:
            answer: ScaleDoneEvent | ScaleFailedEvent = ScaleDoneEvent(
                event="scale_done", box_id=command.box_id, locker_id=command.locker_id, action=command.action, value=5
            )
        else:
            answer = ScaleFailedEvent(
                event="scale_failed",
                box_id=command.box_id,
                locker_id=command.locker_id,
                action=command.action,
                reason=self._reason,
            )
        self._waiter.resolve(answer)
        return True


class TestScaleService:
    @pytest.fixture
    async def session(self, tmp_path: Path) -> AsyncIterator[AsyncSession]:
        database = Database(DatabaseConfig(path=tmp_path / "test.db", busy_timeout_seconds=5, echo=False))
        await database.create_schema()
        async with database.session_factory() as session:
            session.add(Box(id="box", hardware_id="hw", online=True))
            session.add(LockerState(box_id="box", locker_id=0, nfc_flag=False, weight=0.0))
            await session.commit()
            yield session
        await database.dispose()

    def _service(self, session: AsyncSession, reason: str | None = None) -> tuple[ScaleService, AnsweringPublisher]:
        waiter = ScaleResultWaiter()
        publisher = AnsweringPublisher(waiter, reason)
        service = ScaleService(session, publisher, waiter, FailureNotes(), ScaleConfig(answer_timeout_seconds=1))  # type: ignore[arg-type]
        return service, publisher

    async def test_request_returns_the_box_answer(self, session: AsyncSession) -> None:
        service, publisher = self._service(session)
        result = await service.run("box", 0, ScaleAction.REFERENCE, 100)

        assert result.value == 5
        assert publisher.commands[0].grams == 100

    async def test_box_failure_becomes_a_readable_conflict(self, session: AsyncSession) -> None:
        service, _ = self._service(session, reason="cell_present")
        with pytest.raises(ConflictError, match="Ячейка вставлена"):
            await service.run("box", 0, ScaleAction.ZERO, None)

    async def test_reference_needs_grams(self, session: AsyncSession) -> None:
        service, publisher = self._service(session)
        with pytest.raises(ConflictError):
            await service.run("box", 0, ScaleAction.REFERENCE, None)
        assert publisher.commands == []
