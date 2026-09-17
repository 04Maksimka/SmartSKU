from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig, OnboardingConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import Box, BoxClaim
from smartsku_backend.messaging.contracts import ProvisionRequest, ProvisionResponse
from smartsku_backend.services.provisioning import ProvisioningService


class FakePublisher:
    def __init__(self) -> None:
        self.responses: list[ProvisionResponse] = []

    async def send_provision_response(self, response: ProvisionResponse) -> bool:
        self.responses.append(response)
        return True


class TestProvisioningClaims:
    @pytest.fixture
    async def session(self, tmp_path: Path) -> AsyncIterator[AsyncSession]:
        database = Database(DatabaseConfig(path=tmp_path / "test.db", busy_timeout_seconds=5, echo=False))
        await database.create_schema()
        async with database.session_factory() as session:
            yield session
        await database.dispose()

    def _service(self, session: AsyncSession, publisher: FakePublisher) -> ProvisioningService:
        return ProvisioningService(session, publisher, OnboardingConfig(claim_ttl_minutes=30))  # type: ignore[arg-type]

    async def test_unclaimed_box_is_ignored(self, session: AsyncSession) -> None:
        publisher = FakePublisher()
        await self._service(session, publisher).handle(ProvisionRequest(hardware_id="AABB"))
        assert publisher.responses == []
        assert list(await session.scalars(select(Box))) == []

    async def test_claimed_box_registers_once_and_keeps_its_id(self, session: AsyncSession) -> None:
        publisher = FakePublisher()
        service = self._service(session, publisher)
        await service.claim("AABB")
        await service.handle(ProvisionRequest(hardware_id="AABB"))
        await service.handle(ProvisionRequest(hardware_id="AABB"))

        assert len({response.box_id for response in publisher.responses}) == 1
        assert len(publisher.responses) == 2
        assert await session.get(BoxClaim, "AABB") is None

    async def test_expired_claim_is_rejected(self, session: AsyncSession) -> None:
        session.add(BoxClaim(hardware_id="AABB", created_at=datetime.now(UTC) - timedelta(hours=1)))
        await session.commit()
        publisher = FakePublisher()
        await self._service(session, publisher).handle(ProvisionRequest(hardware_id="AABB"))
        assert publisher.responses == []
