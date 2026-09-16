import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Box, Calibration, CalibrationStatus, Component, LockerState
from smartsku_backend.messaging.contracts import CalibrationCommand
from smartsku_backend.messaging.publisher import CommandPublisher
from smartsku_backend.services.errors import ConflictError, NotFoundError

logger = logging.getLogger(__name__)


class CalibrationService:
    def __init__(
        self,
        session: AsyncSession,
        publisher: CommandPublisher,
    ) -> None:
        self._session = session
        self._publisher = publisher

    async def start(
        self,
        *,
        box_id: str,
        locker_id: int,
        name: str,
        tags: list[str],
        num_of_pieces: int,
    ) -> Calibration:
        box = await self._session.get(Box, box_id)
        if box is None:
            raise NotFoundError(f"Box {box_id} not found")
        if not box.online:
            raise ConflictError(f"Box {box_id} is offline")
        state = await self._session.get(LockerState, (box_id, locker_id))
        if state is None:
            raise NotFoundError(f"Locker {locker_id} of box {box_id} has not reported yet")
        if state.nfc_id and await self._session.get(Component, state.nfc_id) is not None:
            raise ConflictError(f"Locker {locker_id} of box {box_id} holds a calibrated cell, release it first")

        await self._session.execute(
            update(Calibration)
            .where(
                Calibration.box_id == box_id,
                Calibration.locker_id == locker_id,
                Calibration.status == CalibrationStatus.PENDING,
            )
            .values(status=CalibrationStatus.CANCELLED)
        )
        calibration = Calibration(
            box_id=box_id,
            locker_id=locker_id,
            name=name,
            tags=tags,
            num_of_pieces=num_of_pieces,
            status=CalibrationStatus.PENDING,
        )
        self._session.add(calibration)
        await self._session.commit()

        command = CalibrationCommand(box_id=box_id, locker_id=locker_id, num_of_pieces=num_of_pieces)
        if not await self._publisher.send_calibration(command):
            calibration.status = CalibrationStatus.CANCELLED
            await self._session.commit()
            raise ConflictError("Calibration command could not be delivered to the broker")
        logger.info("Calibration %s started for box %s locker %s", calibration.id, box_id, locker_id)
        return calibration

    async def list(self, status: CalibrationStatus | None) -> list[Calibration]:
        query = select(Calibration).order_by(Calibration.created_at.desc())
        if status is not None:
            query = query.where(Calibration.status == status)
        return list(await self._session.scalars(query))
