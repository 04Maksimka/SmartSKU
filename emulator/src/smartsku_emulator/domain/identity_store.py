import json
from pathlib import Path


class BoxIdentityStore:
    """Persists hardware_id -> box_id, like the box_id an ESP32 would keep in NVS flash."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> dict[str, str]:
        if not self._path.exists():
            return {}
        return json.loads(self._path.read_text(encoding="utf-8"))

    def save(self, hardware_id: str, box_id: str) -> None:
        identities = self.load()
        identities[hardware_id] = box_id
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(identities, indent=2), encoding="utf-8")
