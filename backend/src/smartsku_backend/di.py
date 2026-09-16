from collections.abc import AsyncIterable

from dishka import AsyncContainer, Provider, Scope, from_context, make_async_container, provide, provide_all
from sqlalchemy.ext.asyncio import AsyncSession

from smartsku_backend.config import AppConfig, MqttConfig, TelemetryConfig
from smartsku_backend.db.database import Database
from smartsku_backend.messaging.publisher import CommandPublisher, MqttConnection
from smartsku_backend.messaging.topics import MqttTopics
from smartsku_backend.services.box_status import BoxStatusService
from smartsku_backend.services.calibration import CalibrationService
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.inventory import ComponentService, InventoryQueryService
from smartsku_backend.services.provisioning import ProvisioningService
from smartsku_backend.services.runtime_cache import LockerRuntimeCache
from smartsku_backend.services.telemetry import TelemetryService
from smartsku_backend.services.tare import TareService


class ConfigProvider(Provider):
    config = from_context(provides=AppConfig, scope=Scope.APP)

    @provide(scope=Scope.APP)
    def mqtt(self, config: AppConfig) -> MqttConfig:
        return config.mqtt

    @provide(scope=Scope.APP)
    def telemetry(self, config: AppConfig) -> TelemetryConfig:
        return config.telemetry


class InfrastructureProvider(Provider):
    @provide(scope=Scope.APP)
    async def database(self, config: AppConfig) -> AsyncIterable[Database]:
        database = Database(config.database)
        yield database
        await database.dispose()

    @provide(scope=Scope.REQUEST)
    async def session(self, database: Database) -> AsyncIterable[AsyncSession]:
        async with database.session_factory() as session:
            yield session

    topics = provide(MqttTopics, scope=Scope.APP)
    connection = provide(MqttConnection, scope=Scope.APP)
    publisher = provide(CommandPublisher, scope=Scope.APP)


class ServicesProvider(Provider):
    cache = provide(LockerRuntimeCache, scope=Scope.APP)
    indicator_policy = provide(IndicatorPolicy, scope=Scope.APP)

    request_services = provide_all(
        TelemetryService,
        BoxStatusService,
        ProvisioningService,
        CalibrationService,
        TareService,
        InventoryQueryService,
        ComponentService,
        scope=Scope.REQUEST,
    )


class ContainerFactory:
    def create(self, config: AppConfig) -> AsyncContainer:
        return make_async_container(
            ConfigProvider(),
            InfrastructureProvider(),
            ServicesProvider(),
            context={AppConfig: config},
        )
