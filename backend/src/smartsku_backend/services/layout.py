from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import LayoutConfig
from smartsku_backend.db.models import Box, Cluster
from smartsku_backend.services.errors import ConflictError, NotFoundError


class LayoutService:
    """Where boxes stand: stands (clusters) and the grid cell of every box, as the user placed them.

    Boxes of a stand are joined physically, so a box is placed right next to another box of its stand. After every
    change the stand's grid is shifted to start at column A and row 1: a box added on the left or below renumbers
    the others, the way addresses on a real stand would read.
    """

    NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1))

    def __init__(self, session: AsyncSession, config: LayoutConfig) -> None:
        self._session = session
        self._config = config

    async def clusters(self) -> list[Cluster]:
        return list(await self._session.scalars(select(Cluster).order_by(Cluster.id)))

    async def rename_cluster(self, cluster_id: int, name: str) -> Cluster:
        cluster = await self._cluster(cluster_id)
        cluster.name = name
        await self._session.commit()
        return cluster

    async def rename_box(self, box_id: str, alias: str | None) -> Box:
        box = await self._box(box_id)
        box.alias = alias or None
        await self._session.commit()
        return box

    async def place(self, box_id: str, cluster_id: int | None, x: int, y: int) -> Box:
        """Puts the box into a grid cell of the stand; no stand given starts a new one with this box alone."""
        box = await self._box(box_id)
        previous_cluster = box.cluster_id
        if cluster_id is None:
            cluster = await self._new_cluster()
            x, y = 0, 0
        else:
            cluster = await self._cluster(cluster_id)
            self._check_cell(box, await self._members(cluster.id), x, y)
        box.cluster_id, box.grid_x, box.grid_y = cluster.id, x, y
        await self._session.flush()
        await self._normalize(cluster.id)
        if previous_cluster is not None and previous_cluster != cluster.id:
            await self._normalize(previous_cluster)
        await self._session.commit()
        return box

    async def unplace(self, box_id: str) -> Box:
        box = await self._box(box_id)
        previous_cluster = box.cluster_id
        box.cluster_id, box.grid_x, box.grid_y = None, None, None
        await self._session.flush()
        if previous_cluster is not None:
            await self._normalize(previous_cluster)
        await self._session.commit()
        return box

    def _check_cell(self, box: Box, members: list[Box], x: int, y: int) -> None:
        others = [member for member in members if member.id != box.id]
        taken = next((member for member in others if (member.grid_x, member.grid_y) == (x, y)), None)
        if taken is not None:
            raise ConflictError(f"Место занято боксом {taken.address}")
        cells = {(member.grid_x, member.grid_y) for member in others}
        if cells and not any((x + dx, y + dy) in cells for dx, dy in self.NEIGHBOURS):
            raise ConflictError("Бокс ставится вплотную к другому боксу стенда: слева, справа, сверху или снизу")

    async def _normalize(self, cluster_id: int) -> None:
        """Shifts the grid so it starts at A1; a stand left without boxes is removed."""
        members = await self._members(cluster_id)
        if not members:
            cluster = await self._session.get(Cluster, cluster_id)
            if cluster is not None:
                await self._session.delete(cluster)
            return
        min_x = min(member.grid_x or 0 for member in members)
        min_y = min(member.grid_y or 0 for member in members)
        for member in members:
            member.grid_x = (member.grid_x or 0) - min_x
            member.grid_y = (member.grid_y or 0) - min_y

    async def _new_cluster(self) -> Cluster:
        count = await self._session.scalar(select(func.count()).select_from(Cluster)) or 0
        names = set(await self._session.scalars(select(Cluster.name)))
        number = count + 1
        while f"{self._config.cluster_name_prefix} {number}" in names:
            number += 1
        cluster = Cluster(name=f"{self._config.cluster_name_prefix} {number}")
        self._session.add(cluster)
        await self._session.flush()
        return cluster

    async def _members(self, cluster_id: int) -> list[Box]:
        return list(await self._session.scalars(select(Box).where(Box.cluster_id == cluster_id)))

    async def _cluster(self, cluster_id: int) -> Cluster:
        cluster = await self._session.get(Cluster, cluster_id)
        if cluster is None:
            raise NotFoundError(f"Стенд {cluster_id} не найден")
        return cluster

    async def _box(self, box_id: str) -> Box:
        box = await self._session.get(Box, box_id)
        if box is None:
            raise NotFoundError(f"Бокс {box_id} не найден")
        return box
