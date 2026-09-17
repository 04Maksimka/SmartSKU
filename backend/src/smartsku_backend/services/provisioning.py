import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import OnboardingConfig
from smartsku_backend.db.models import Box, BoxClaim
from smartsku_backend.messaging.contracts import ProvisionRequest, ProvisionResponse
from smartsku_backend.messaging.publisher import CommandPublisher

logger = logging.getLogger(__name__)


class ProvisioningService:
    """Assigns a box_id to a box identified by its hardware id. Idempotent: a re-flashed box gets its old id back.

    A new box is registered only if the user claimed it from the dashboard, so a stray device on the network
    cannot add itself to the warehouse.
    """

    BOX_ID_LENGTH = 12

    def __init__(self, session: AsyncSession, publisher: CommandPublisher, config: OnboardingConfig) -> None:
        self._session = session
        self._publisher = publisher
        self._config = config

    async def claim(self, hardware_id: str) -> None:
        claim = await self._session.get(BoxClaim, hardware_id)
        if claim is None:
            self._session.add(BoxClaim(hardware_id=hardware_id))
        else:
            claim.created_at = datetime.now(UTC)
        await self._session.commit()
        logger.info("Box %s claimed from the dashboard", hardware_id)

    async def handle(self, request: ProvisionRequest) -> None:
        box = await self._session.scalar(select(Box).where(Box.hardware_id == request.hardware_id))
        if box is None:
            if not await self._take_claim(request.hardware_id):
                logger.warning("Provision request from unclaimed box %s ignored", request.hardware_id)
                return
            box = Box(id=uuid4().hex[: self.BOX_ID_LENGTH], hardware_id=request.hardware_id)
            self._session.add(box)
            await self._session.commit()
            logger.info("Registered new box %s (hardware %s)", box.id, box.hardware_id)
        await self._publisher.send_provision_response(ProvisionResponse(hardware_id=box.hardware_id, box_id=box.id))

    async def _take_claim(self, hardware_id: str) -> bool:
        claim = await self._session.get(BoxClaim, hardware_id)
        if claim is None:
            return False
        await self._session.delete(claim)
        return datetime.now(UTC) - claim.created_at <= timedelta(minutes=self._config.claim_ttl_minutes)
