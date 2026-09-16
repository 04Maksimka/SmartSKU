import contextlib
import logging
from collections.abc import AsyncIterator

from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from smartsku_emulator.api.controllers import FleetController
from smartsku_emulator.config import EmulatorConfig
from smartsku_emulator.di import ContainerFactory
from smartsku_emulator.domain.errors import EmulatorError, NotFoundError
from smartsku_emulator.messaging.supervisor import FleetSupervisor


class ApplicationFactory:
    def __init__(self, config: EmulatorConfig) -> None:
        self._container = ContainerFactory().create(config)

    def create(self) -> FastAPI:
        app = FastAPI(title="SmartSKU ESP32 emulator", lifespan=self._lifespan)
        app.include_router(FleetController().router)
        app.add_exception_handler(EmulatorError, self._error_handler)
        setup_dishka(self._container, app)
        return app

    @contextlib.asynccontextmanager
    async def _lifespan(self, app: FastAPI) -> AsyncIterator[None]:
        supervisor = await self._container.get(FleetSupervisor)
        supervisor.start_all()
        try:
            yield
        finally:
            await supervisor.stop_all()
            await self._container.close()

    async def _error_handler(self, request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=404 if isinstance(error, NotFoundError) else 409, content={"detail": str(error)}
        )


class LoggingConfigurator:
    def configure(self, config: EmulatorConfig) -> None:
        logging.basicConfig(level=config.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
