import asyncio
import logging
from typing import Annotated

import aiomqtt
from pydantic import Field, TypeAdapter, ValidationError

from smartsku_emulator.config import EmulatorConfig
from smartsku_emulator.domain.errors import EmulatorError
from smartsku_emulator.domain.identity_store import BoxIdentityStore
from smartsku_emulator.domain.model import VirtualBox
from smartsku_emulator.messaging.contracts import (
    BoxDataMessage,
    CalibrationCommand,
    IndicatorsCommand,
    ProvisionRequest,
    ProvisionResponse,
)
from smartsku_emulator.messaging.topics import MqttTopics

logger = logging.getLogger(__name__)


class BoxLink:
    """The MQTT side of one emulated ESP32: provisioning, periodic telemetry, command handling."""

    COMMAND_ADAPTER: TypeAdapter[CalibrationCommand | IndicatorsCommand] = TypeAdapter(
        Annotated[CalibrationCommand | IndicatorsCommand, Field(discriminator="command")]
    )

    def __init__(
        self,
        box: VirtualBox,
        config: EmulatorConfig,
        topics: MqttTopics,
        identity_store: BoxIdentityStore,
    ) -> None:
        self._box = box
        self._config = config
        self._mqtt = config.mqtt
        self._topics = topics
        self._identity_store = identity_store

    async def run(self) -> None:
        while True:
            try:
                if self._box.box_id is None:
                    await self._provision()
                await self._serve()
            except* (aiomqtt.MqttError, TimeoutError) as group:
                logger.warning("Box %s link error: %s", self._box.hardware_id, group.exceptions)
            finally:
                self._box.connected = False
            await asyncio.sleep(self._mqtt.reconnect_interval_seconds)

    async def _provision(self) -> None:
        hardware_id = self._box.hardware_id
        async with aiomqtt.Client(
            hostname=self._mqtt.host, port=self._mqtt.port, identifier=f"provision-{hardware_id}"
        ) as client:
            await client.subscribe(self._topics.provision_response(hardware_id), qos=1)
            await client.publish(
                self._topics.provision_request, ProvisionRequest(hardware_id=hardware_id).model_dump_json(), qos=1
            )
            async with asyncio.timeout(self._mqtt.provision_timeout_seconds):
                async for message in client.messages:
                    response = ProvisionResponse.model_validate_json(self._payload(message))
                    self._box.box_id = response.box_id
                    self._identity_store.save(hardware_id, response.box_id)
                    logger.info("Box %s provisioned as %s", hardware_id, response.box_id)
                    return

    async def _serve(self) -> None:
        box_id = self._box.box_id
        assert box_id is not None
        will = aiomqtt.Will(topic=self._topics.box_status(box_id), payload="offline", qos=1, retain=True)
        async with aiomqtt.Client(
            hostname=self._mqtt.host,
            port=self._mqtt.port,
            identifier=f"box-{self._box.hardware_id}",
            keepalive=self._mqtt.keepalive_seconds,
            will=will,
        ) as client:
            await client.subscribe(self._topics.box_commands(box_id), qos=1)
            await client.publish(self._topics.box_status(box_id), "online", qos=1, retain=True)
            self._box.connected = True
            logger.info("Box %s (%s) online", box_id, self._box.hardware_id)
            async with asyncio.TaskGroup() as tasks:
                tasks.create_task(self._publish_telemetry(client, box_id))
                tasks.create_task(self._listen_commands(client))

    async def _publish_telemetry(self, client: aiomqtt.Client, box_id: str) -> None:
        while True:
            message = BoxDataMessage(box_id=box_id, lockers=self._box.readings(self._config.weight_noise_grams))
            await client.publish(self._topics.box_data(box_id), message.model_dump_json(), qos=0)
            await asyncio.sleep(self._config.publish_interval_seconds)

    async def _listen_commands(self, client: aiomqtt.Client) -> None:
        async for message in client.messages:
            try:
                command = self.COMMAND_ADAPTER.validate_json(self._payload(message))
                if isinstance(command, CalibrationCommand):
                    self._box.apply_calibration(command.locker_id, command.num_of_pieces)
                    logger.info("Box %s locker %s awaits calibration", command.box_id, command.locker_id)
                else:
                    self._box.apply_indicators(command.locker_id, command.led_color, command.screen_number)
            except (ValidationError, ValueError, EmulatorError) as error:
                logger.warning("Box %s rejected command: %s", self._box.hardware_id, error)

    def _payload(self, message: aiomqtt.Message) -> bytes:
        return message.payload if isinstance(message.payload, bytes) else str(message.payload).encode()
