import logging

import aiomqtt
from pydantic import BaseModel

from smartsku_backend.messaging.contracts import CalibrationCommand, IndicatorsCommand, ProvisionResponse
from smartsku_backend.messaging.topics import MqttTopics

logger = logging.getLogger(__name__)


class MqttConnection:
    """Holds the currently connected MQTT client; the gateway attaches/detaches it on (re)connect."""

    def __init__(self) -> None:
        self._client: aiomqtt.Client | None = None

    def attach(self, client: aiomqtt.Client) -> None:
        self._client = client

    def detach(self) -> None:
        self._client = None

    async def publish(self, topic: str, message: BaseModel, qos: int) -> bool:
        if self._client is None:
            logger.warning("MQTT is not connected, message to %s dropped", topic)
            return False
        try:
            await self._client.publish(topic, message.model_dump_json(), qos=qos)
        except aiomqtt.MqttError as error:
            logger.warning("Failed to publish to %s: %s", topic, error)
            return False
        return True


class CommandPublisher:
    COMMAND_QOS = 1

    def __init__(self, connection: MqttConnection, topics: MqttTopics) -> None:
        self._connection = connection
        self._topics = topics

    async def send_calibration(self, command: CalibrationCommand) -> bool:
        return await self._connection.publish(self._topics.box_commands(command.box_id), command, self.COMMAND_QOS)

    async def send_indicators(self, command: IndicatorsCommand) -> bool:
        return await self._connection.publish(self._topics.box_commands(command.box_id), command, self.COMMAND_QOS)

    async def send_provision_response(self, response: ProvisionResponse) -> bool:
        return await self._connection.publish(
            self._topics.provision_response(response.hardware_id), response, self.COMMAND_QOS
        )
