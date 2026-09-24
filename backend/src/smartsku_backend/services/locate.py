import logging
from dataclasses import dataclass

from smartsku_backend.config import LocateConfig
from smartsku_backend.services.assembly import StockCell, StockService
from smartsku_backend.services.clock import MonotonicClock
from smartsku_backend.services.errors import NotFoundError
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.specifications import ComponentName

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LocateTarget:
    name: str
    key: str
    until: float


class ComponentLocator:
    """The component the user is looking for: the displays of its cells blink for locate.seconds.

    In memory only: a search is a moment at the rack, a restart simply ends it.
    """

    def __init__(self, config: LocateConfig, clock: MonotonicClock) -> None:
        self._config = config
        self._clock = clock
        self._target: LocateTarget | None = None

    def start(self, name: str) -> None:
        self._target = LocateTarget(name, ComponentName.key(name), self._clock.now() + self._config.seconds)

    def stop(self) -> None:
        self._target = None

    def current(self) -> LocateTarget | None:
        target = self._target
        return target if target is not None and self._clock.now() < target.until else None

    def matches(self, component_name: str) -> bool:
        target = self.current()
        return target is not None and ComponentName.key(component_name) == target.key

    def take_expired(self) -> bool:
        """True once when the search runs out: the displays must stop blinking."""
        if self._target is not None and self.current() is None:
            self._target = None
            return True
        return False

    def seconds_left(self) -> float:
        target = self.current()
        return max(0.0, target.until - self._clock.now()) if target is not None else 0.0


@dataclass(frozen=True)
class LocateView:
    name: str
    seconds_left: float
    # Cells of the component standing in slots now: their displays blink
    cells: list[StockCell]
    # Pieces in its cells that are pulled out or in a box off line
    elsewhere: int


class LocateService:
    """Finding a component on the stands: its cells light up on the dashboard and their displays blink."""

    def __init__(self, locator: ComponentLocator, stock: StockService, cache: LockerRuntimeCache) -> None:
        self._locator = locator
        self._stock = stock
        self._cache = cache

    async def start(self, name: str) -> LocateView:
        cells = (await self._stock.cells()).get(ComponentName.key(name))
        if not cells:
            raise NotFoundError(f"Компонента «{name}» на складе нет")
        self._locator.start(cells[0].component.name)
        # Every box resends its indicators with the next telemetry, now blinking where the component lies
        self._cache.forget_all()
        logger.info("Locating '%s'", name)
        view = await self.current()
        assert view is not None
        return view

    def stop(self) -> None:
        if self._locator.current() is not None:
            self._locator.stop()
            self._cache.forget_all()

    async def current(self) -> LocateView | None:
        target = self._locator.current()
        if target is None:
            return None
        cells = (await self._stock.cells()).get(target.key, [])
        return LocateView(
            name=target.name,
            seconds_left=self._locator.seconds_left(),
            cells=[cell for cell in cells if cell.state is not None],
            elsewhere=sum(cell.quantity for cell in cells if cell.state is None),
        )
