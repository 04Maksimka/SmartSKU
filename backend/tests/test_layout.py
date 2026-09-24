from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import DatabaseConfig, LayoutConfig
from smartsku_backend.db.database import Database
from smartsku_backend.db.models import Box, Cluster
from smartsku_backend.services.errors import ConflictError
from smartsku_backend.services.layout import LayoutService


class TestLayout:
    @pytest.fixture
    async def session(self, tmp_path: Path) -> AsyncIterator[AsyncSession]:
        database = Database(DatabaseConfig(path=tmp_path / "test.db", busy_timeout_seconds=5, echo=False))
        await database.create_schema()
        async with database.session_factory() as session:
            session.add_all([Box(id=box_id, hardware_id=f"hw-{box_id}") for box_id in ("a", "b", "c")])
            await session.commit()
            yield session
        await database.dispose()

    @pytest.fixture
    def layout(self, session: AsyncSession) -> LayoutService:
        return LayoutService(session, LayoutConfig())

    async def _addresses(self, session: AsyncSession) -> dict[str, str | None]:
        return {box.id: box.address for box in await session.scalars(select(Box))}

    async def test_first_box_starts_a_stand_at_a1(self, layout: LayoutService, session: AsyncSession) -> None:
        box = await layout.place("a", None, 5, 5)
        cluster = await session.get(Cluster, box.cluster_id)
        assert box.address == "A1"
        assert cluster is not None and cluster.name == "Стенд 1"

    async def test_box_on_the_left_or_below_renumbers_the_stand(
        self, layout: LayoutService, session: AsyncSession
    ) -> None:
        first = await layout.place("a", None, 0, 0)
        await layout.place("b", first.cluster_id, -1, 0)
        await layout.place("c", first.cluster_id, 1, -1)
        assert await self._addresses(session) == {"a": "B2", "b": "A2", "c": "B1"}

    async def test_box_stacked_on_top_keeps_lower_addresses(self, layout: LayoutService, session: AsyncSession) -> None:
        first = await layout.place("a", None, 0, 0)
        await layout.place("b", first.cluster_id, 0, 1)
        assert await self._addresses(session) == {"a": "A1", "b": "A2", "c": None}

    async def test_taken_or_detached_cell_is_rejected(self, layout: LayoutService) -> None:
        first = await layout.place("a", None, 0, 0)
        with pytest.raises(ConflictError, match="занято"):
            await layout.place("b", first.cluster_id, 0, 0)
        with pytest.raises(ConflictError, match="вплотную"):
            await layout.place("b", first.cluster_id, 2, 0)

    async def test_last_box_leaving_removes_the_stand(self, layout: LayoutService, session: AsyncSession) -> None:
        first = await layout.place("a", None, 0, 0)
        await layout.place("b", first.cluster_id, 1, 0)
        await layout.unplace("a")
        assert await self._addresses(session) == {"a": None, "b": "A1", "c": None}

    async def test_moving_to_a_new_stand_removes_the_empty_one(
        self, layout: LayoutService, session: AsyncSession
    ) -> None:
        first_cluster = (await layout.place("a", None, 0, 0)).cluster_id
        moved = await layout.place("a", None, 0, 0)
        assert moved.cluster_id != first_cluster
        assert [cluster.id for cluster in await layout.clusters()] == [moved.cluster_id]

    def test_columns_past_z_use_two_letters(self) -> None:
        assert Box(cluster_id=1, grid_x=25, grid_y=0).address == "Z1"
        assert Box(cluster_id=1, grid_x=26, grid_y=2).address == "AA3"
