from smartsku_backend.config import MqttConfig


class MqttTopics:
    """Topic layout shared with ESP firmware and the emulator (see README)."""

    def __init__(self, config: MqttConfig) -> None:
        self._prefix = config.topic_prefix

    @property
    def provision_request(self) -> str:
        return f"{self._prefix}/provision/request"

    def provision_response(self, hardware_id: str) -> str:
        return f"{self._prefix}/provision/response/{hardware_id}"

    @property
    def all_box_data(self) -> str:
        return f"{self._prefix}/boxes/+/data"

    @property
    def all_box_status(self) -> str:
        return f"{self._prefix}/boxes/+/status"

    @property
    def all_box_events(self) -> str:
        return f"{self._prefix}/boxes/+/events"

    def box_commands(self, box_id: str) -> str:
        return f"{self._prefix}/boxes/{box_id}/commands"

    def box_id_from_topic(self, topic: str) -> str:
        return topic.split("/")[-2]
