from dishka import AsyncContainer, Provider, Scope, from_context, make_async_container, provide

from smartsku_emulator.config import EmulatorConfig, MqttConfig
from smartsku_emulator.domain.identity_store import BoxIdentityStore
from smartsku_emulator.domain.model import Fleet
from smartsku_emulator.domain.state_store import FleetStateStore
from smartsku_emulator.messaging.supervisor import FleetFactory, FleetSupervisor
from smartsku_emulator.messaging.topics import MqttTopics


class EmulatorProvider(Provider):
    scope = Scope.APP

    config = from_context(provides=EmulatorConfig)

    @provide
    def mqtt(self, config: EmulatorConfig) -> MqttConfig:
        return config.mqtt

    @provide
    def identity_store(self, config: EmulatorConfig) -> BoxIdentityStore:
        return BoxIdentityStore(config.identity_store_path)

    @provide
    def state_store(self, config: EmulatorConfig) -> FleetStateStore:
        return FleetStateStore(config.fleet_state_path)

    @provide
    def fleet(self, config: EmulatorConfig, identity_store: BoxIdentityStore, state_store: FleetStateStore) -> Fleet:
        return FleetFactory(config, identity_store, state_store).create()

    topics = provide(MqttTopics)
    supervisor = provide(FleetSupervisor)


class ContainerFactory:
    def create(self, config: EmulatorConfig) -> AsyncContainer:
        return make_async_container(EmulatorProvider(), context={EmulatorConfig: config})
