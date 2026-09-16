import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Box, DeletedBox
from smartsku_backend.services.runtime_cache import LockerRuntimeCache

logger = logging.getLogger(__name__)


class BoxStatusService:
    ONLINE = "online"

    def __init__(self, session: AsyncSession, cache: LockerRuntimeCache) -> None:
        self._session = session
        self._cache = cache

    async def handle(self, box_id: str, status: str) -> None:
        box = await self._session.get(Box, box_id)
        if box is None:
            logger.warning("Status from unknown box %s ignored", box_id)
            return
        if await self._session.get(DeletedBox, box_id) is not None:
            return
        box.online = status == self.ONLINE
        box.status_changed_at = datetime.now(UTC)
        await self._session.commit()
        if box.online:
            # A (re)connected box may have rebooted and lost its displays, so indicators must be re-sent.
            self._cache.forget_box(box_id)
        logger.info("Box %s is %s", box_id, status)
