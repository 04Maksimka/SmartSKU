import asyncio
import logging

import aiomqtt
from dishka import AsyncContainer
from pydantic import TypeAdapter, ValidationError

from smartsku_backend.config import MqttConfig
from smartsku_backend.messaging.contracts import BoxDataMessage, BoxEvent, ProvisionRequest
from smartsku_backend.messaging.publisher import MqttConnection
from smartsku_backend.messaging.topics import MqttTopics
from smartsku_backend.services.box_events import BoxEventService
from smartsku_backend.services.box_status import BoxStatusService
from smartsku_backend.services.provisioning import ProvisioningService
from smartsku_backend.services.telemetry import TelemetryService

logger = logging.getLogger(__name__)


class MqttGateway:
    """Keeps the broker connection alive and routes incoming box messages to request-scoped services."""

    EVENT_ADAPTER: TypeAdapter[BoxEvent] = TypeAdapter(BoxEvent)

    def __init__(
        self,
        config: MqttConfig,
        topics: MqttTopics,
        connection: MqttConnection,
        container: AsyncContainer,
    ) -> None:
        self._config = config
        self._topics = topics
        self._connection = connection
        self._container = container

    async def run(self) -> None:
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=self._config.host,
                    port=self._config.port,
                    identifier=self._config.client_id,
                    keepalive=self._config.keepalive_seconds,
                ) as client:
                    self._connection.attach(client)
                    await self._subscribe(client)
                    logger.info("Connected to MQTT broker %s:%s", self._config.host, self._config.port)
                    async for message in client.messages:
                        await self._dispatch(message)
            except aiomqtt.MqttError as error:
                logger.warning("MQTT connection lost: %s", error)
            finally:
                self._connection.detach()
            await asyncio.sleep(self._config.reconnect_interval_seconds)

    async def _subscribe(self, client: aiomqtt.Client) -> None:
        await client.subscribe(self._topics.provision_request, qos=1)
        await client.subscribe(self._topics.all_box_data, qos=0)
        await client.subscribe(self._topics.all_box_status, qos=1)
        await client.subscribe(self._topics.all_box_events, qos=1)

    async def _dispatch(self, message: aiomqtt.Message) -> None:
        payload = message.payload if isinstance(message.payload, (bytes, str)) else b""
        try:
            async with self._container() as scope:
                if message.topic.matches(self._topics.all_box_data):
                    telemetry = await scope.get(TelemetryService)
                    await telemetry.handle(BoxDataMessage.model_validate_json(payload))
                elif message.topic.matches(self._topics.all_box_status):
                    status = await scope.get(BoxStatusService)
                    box_id = self._topics.box_id_from_topic(message.topic.value)
                    text = payload.decode() if isinstance(payload, bytes) else payload
                    await status.handle(box_id, text)
                elif message.topic.matches(self._topics.all_box_events):
                    events = await scope.get(BoxEventService)
                    await events.handle(self.EVENT_ADAPTER.validate_json(payload))
                elif message.topic.matches(self._topics.provision_request):
                    provisioning = await scope.get(ProvisioningService)
                    await provisioning.handle(ProvisionRequest.model_validate_json(payload))
        except ValidationError as error:
            logger.warning("Malformed message on %s: %s", message.topic.value, error)
        except Exception:
            logger.exception("Failed to process message on %s", message.topic.value)
