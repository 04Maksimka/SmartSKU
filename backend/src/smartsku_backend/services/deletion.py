from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import (
    Box,
    Calibration,
    CalibrationStatus,
    DeletedBox,
    DeletedLocker,
    LockerState,
)
from smartsku_backend.services.errors import NotFoundError
from smartsku_backend.services.runtime_cache import LockerRuntimeCache


class DeletionService:
    """Hide retired hardware from the warehouse while preserving inventory history."""

    def __init__(self, session: AsyncSession, cache: LockerRuntimeCache) -> None:
        self._session = session
        self._cache = cache

    async def box(self, box_id: str) -> None:
        if await self._session.get(Box, box_id) is None or await self._session.get(DeletedBox, box_id):
            raise NotFoundError(f"Box {box_id} not found")
        self._session.add(DeletedBox(box_id=box_id))
        await self._session.execute(
            update(Calibration)
            .where(Calibration.box_id == box_id, Calibration.status == CalibrationStatus.PENDING)
            .values(status=CalibrationStatus.CANCELLED)
        )
        await self._session.commit()
        self._cache.forget_box(box_id)

    async def locker(self, box_id: str, locker_id: int) -> None:
        if await self._session.get(DeletedBox, box_id):
            raise NotFoundError(f"Box {box_id} not found")
        state = await self._session.get(LockerState, (box_id, locker_id))
        if state is None or await self._session.get(DeletedLocker, (box_id, locker_id)):
            raise NotFoundError(f"Locker {locker_id} of box {box_id} not found")
        self._session.add(DeletedLocker(box_id=box_id, locker_id=locker_id))
        await self._session.execute(
            update(Calibration)
            .where(
                Calibration.box_id == box_id,
                Calibration.locker_id == locker_id,
                Calibration.status == CalibrationStatus.PENDING,
            )
            .values(status=CalibrationStatus.CANCELLED)
        )
        await self._session.execute(
            delete(LockerState).where(LockerState.box_id == box_id, LockerState.locker_id == locker_id)
        )
        await self._session.commit()
        self._cache.forget_box(box_id)
