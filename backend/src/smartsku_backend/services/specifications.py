from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.db.models import Assembly, Specification, SpecificationItem
from smartsku_backend.services.errors import ConflictError, NotFoundError


class ComponentName:
    """Specifications name components the way people type them: case and extra spaces do not matter."""

    @staticmethod
    def key(name: str) -> str:
        return " ".join(name.split()).casefold()

    @staticmethod
    def clean(name: str) -> str:
        return " ".join(name.split())


@dataclass(frozen=True)
class SpecificationLine:
    component_name: str
    quantity: int


@dataclass(frozen=True)
class SpecificationView:
    specification: Specification
    items: list[SpecificationItem]


class SpecificationService:
    """Products and the components one piece of each takes."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def all(self) -> list[SpecificationView]:
        specifications = list(await self._session.scalars(select(Specification).order_by(Specification.name)))
        items = list(await self._session.scalars(select(SpecificationItem).order_by(SpecificationItem.position)))
        return [
            SpecificationView(specification, [item for item in items if item.specification_id == specification.id])
            for specification in specifications
        ]

    async def get(self, specification_id: int) -> SpecificationView:
        specification = await self._session.get(Specification, specification_id)
        if specification is None:
            raise NotFoundError(f"Спецификация {specification_id} не найдена")
        items = await self._session.scalars(
            select(SpecificationItem)
            .where(SpecificationItem.specification_id == specification_id)
            .order_by(SpecificationItem.position)
        )
        return SpecificationView(specification, list(items))

    async def create(self, name: str, lines: list[SpecificationLine]) -> SpecificationView:
        specification = Specification(name=self._name(name))
        self._session.add(specification)
        await self._session.flush()
        self._add_items(specification.id, lines)
        await self._session.commit()
        return await self.get(specification.id)

    async def update(self, specification_id: int, name: str, lines: list[SpecificationLine]) -> SpecificationView:
        specification = (await self.get(specification_id)).specification
        specification.name = self._name(name)
        specification.updated_at = datetime.now(UTC)
        await self._session.execute(
            delete(SpecificationItem).where(SpecificationItem.specification_id == specification_id)
        )
        self._add_items(specification_id, lines)
        await self._session.commit()
        return await self.get(specification_id)

    async def delete(self, specification_id: int) -> None:
        specification = (await self.get(specification_id)).specification
        # Past assemblies keep the name of what they assembled
        await self._session.execute(
            update(Assembly).where(Assembly.specification_id == specification_id).values(specification_id=None)
        )
        await self._session.execute(
            delete(SpecificationItem).where(SpecificationItem.specification_id == specification_id)
        )
        await self._session.delete(specification)
        await self._session.commit()

    def _name(self, name: str) -> str:
        cleaned = ComponentName.clean(name)
        if not cleaned:
            raise ConflictError("Укажите название изделия")
        return cleaned

    def _add_items(self, specification_id: int, lines: list[SpecificationLine]) -> None:
        """The same component typed twice becomes one line with the quantities added up."""
        merged: dict[str, SpecificationLine] = {}
        for line in lines:
            name = ComponentName.clean(line.component_name)
            if not name:
                raise ConflictError("У каждой строки спецификации должен быть компонент")
            key = ComponentName.key(name)
            previous = merged.get(key)
            merged[key] = (
                SpecificationLine(name, line.quantity)
                if previous is None
                else SpecificationLine(previous.component_name, previous.quantity + line.quantity)
            )
        if not merged:
            raise ConflictError("В спецификации нет ни одного компонента")
        for position, line in enumerate(merged.values()):
            self._session.add(
                SpecificationItem(
                    specification_id=specification_id,
                    position=position,
                    component_name=line.component_name,
                    quantity=line.quantity,
                )
            )
