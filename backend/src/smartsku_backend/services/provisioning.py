import logging
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Box
from smartsku_backend.messaging.contracts import ProvisionRequest, ProvisionResponse
from smartsku_backend.messaging.publisher import CommandPublisher

logger = logging.getLogger(__name__)


class ProvisioningService:
    """Assigns a box_id to a box identified by its hardware id. Idempotent: a re-flashed box gets its old id back."""

    BOX_ID_LENGTH = 12

    def __init__(self, session: AsyncSession, publisher: CommandPublisher) -> None:
        self._session = session
        self._publisher = publisher

    async def handle(self, request: ProvisionRequest) -> None:
        box = await self._session.scalar(select(Box).where(Box.hardware_id == request.hardware_id))
        if box is None:
            box = Box(id=uuid4().hex[: self.BOX_ID_LENGTH], hardware_id=request.hardware_id)
            self._session.add(box)
            await self._session.commit()
            logger.info("Registered new box %s (hardware %s)", box.id, box.hardware_id)
        await self._publisher.send_provision_response(ProvisionResponse(hardware_id=box.hardware_id, box_id=box.id))
