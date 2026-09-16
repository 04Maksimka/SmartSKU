import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from dishka import AsyncContainer
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from smartsku_backend.api.controllers import BoxesController, CalibrationController, ComponentsController
from smartsku_backend.config import AppConfig, MqttConfig
from smartsku_backend.db.database import Database
from smartsku_backend.di import ContainerFactory
from smartsku_backend.messaging.gateway import MqttGateway
from smartsku_backend.messaging.publisher import MqttConnection
from smartsku_backend.messaging.topics import MqttTopics
from smartsku_backend.services.errors import ConflictError, DomainError, NotFoundError


class ApplicationFactory:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._container: AsyncContainer = ContainerFactory().create(config)

    def create(self) -> FastAPI:
        app = FastAPI(title="SmartSKU backend", lifespan=self._lifespan)
        for controller in (BoxesController(), CalibrationController(), ComponentsController()):
            app.include_router(controller.router)
        app.add_api_route("/health", self._health, methods=["GET"])
        app.add_exception_handler(DomainError, self._domain_error_handler)
        setup_dishka(self._container, app)
        return app

    @contextlib.asynccontextmanager
    async def _lifespan(self, app: FastAPI) -> AsyncIterator[None]:
        database = await self._container.get(Database)
        await database.create_schema()
        gateway = MqttGateway(
            config=await self._container.get(MqttConfig),
            topics=await self._container.get(MqttTopics),
            connection=await self._container.get(MqttConnection),
            container=self._container,
        )
        gateway_task = asyncio.create_task(gateway.run(), name="mqtt-gateway")
        try:
            yield
        finally:
            gateway_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await gateway_task
            await self._container.close()

    async def _health(self) -> dict[str, str]:
        return {"status": "ok"}

    async def _domain_error_handler(self, request: Request, error: Exception) -> JSONResponse:
        status_code = 404 if isinstance(error, NotFoundError) else 409 if isinstance(error, ConflictError) else 400
        return JSONResponse(status_code=status_code, content={"detail": str(error)})


class LoggingConfigurator:
    def configure(self, config: AppConfig) -> None:
        logging.basicConfig(
            level=config.logging.level,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
