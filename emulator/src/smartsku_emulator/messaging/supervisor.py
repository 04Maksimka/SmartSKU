import asyncio
import contextlib

from smartsku_emulator.config import EmulatorConfig
from smartsku_emulator.domain.identity_store import BoxIdentityStore
from smartsku_emulator.domain.model import Fleet, VirtualBox
from smartsku_emulator.messaging.box_link import BoxLink
from smartsku_emulator.messaging.topics import MqttTopics


class FleetSupervisor:
    """Runs one MQTT link per emulated box, including boxes added at runtime through the REST API."""

    def __init__(
        self,
        fleet: Fleet,
        config: EmulatorConfig,
        topics: MqttTopics,
        identity_store: BoxIdentityStore,
    ) -> None:
        self._fleet = fleet
        self._config = config
        self._topics = topics
        self._identity_store = identity_store
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def start_all(self) -> None:
        for box in self._fleet.boxes.values():
            self.start(box)

    def start(self, box: VirtualBox) -> None:
        link = BoxLink(box, self._config, self._topics, self._identity_store)
        self._tasks[box.hardware_id] = asyncio.create_task(link.run(), name=f"box-{box.hardware_id}")

    async def stop_all(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        for task in self._tasks.values():
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()


class FleetFactory:
    def __init__(self, config: EmulatorConfig, identity_store: BoxIdentityStore) -> None:
        self._config = config
        self._identity_store = identity_store

    def create(self) -> Fleet:
        fleet = Fleet()
        identities = self._identity_store.load()
        for seed in self._config.boxes:
            box = VirtualBox(seed.hardware_id, seed.lockers_count, identities.get(seed.hardware_id))
            fleet.add_box(box)
            for cell_seed in seed.cells:
                fleet.create_cell(cell_seed.nfc_id)
                fleet.insert(seed.hardware_id, cell_seed.locker_id, cell_seed.nfc_id)
        for cell_seed in self._config.loose_cells:
            fleet.create_cell(cell_seed.nfc_id)
        return fleet
