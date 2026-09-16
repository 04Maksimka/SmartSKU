import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from smartsku_emulator.domain.model import Fleet

logger = logging.getLogger(__name__)


class NullFleetStateStore:
    """Used in tests: the fleet lives only in memory."""

    def attach(self, fleet: "Fleet") -> None:
        pass

    def load(self) -> dict[str, Any] | None:
        return None

    def record(self) -> None:
        pass


class FleetStateStore(NullFleetStateStore):
    """Keeps the virtual scales across restarts.

    Real hardware does not forget either: the load cell still measures the physical weight after a reboot,
    and the piece weight learned during calibration lives in ESP32 NVS flash next to the box_id.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._fleet: Fleet | None = None

    def attach(self, fleet: "Fleet") -> None:
        self._fleet = fleet

    def load(self) -> dict[str, Any] | None:
        if not self._path.exists():
            return None
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logger.exception("Fleet state at %s is unreadable, starting from the config seeds", self._path)
            return None

    def record(self) -> None:
        if self._fleet is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_suffix(f"{self._path.suffix}.tmp")
        temporary.write_text(json.dumps(self._fleet.snapshot(), ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self._path)
