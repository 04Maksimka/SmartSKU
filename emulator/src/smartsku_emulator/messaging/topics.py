from smartsku_emulator.config import MqttConfig


class MqttTopics:
    def __init__(self, config: MqttConfig) -> None:
        self._prefix = config.topic_prefix

    @property
    def provision_request(self) -> str:
        return f"{self._prefix}/provision/request"

    def provision_response(self, hardware_id: str) -> str:
        return f"{self._prefix}/provision/response/{hardware_id}"

    def box_data(self, box_id: str) -> str:
        return f"{self._prefix}/boxes/{box_id}/data"

    def box_status(self, box_id: str) -> str:
        return f"{self._prefix}/boxes/{box_id}/status"

    def box_events(self, box_id: str) -> str:
        return f"{self._prefix}/boxes/{box_id}/events"

    def box_commands(self, box_id: str) -> str:
        return f"{self._prefix}/boxes/{box_id}/commands"
