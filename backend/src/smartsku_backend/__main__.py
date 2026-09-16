import uvicorn

from smartsku_backend.app import ApplicationFactory, LoggingConfigurator
from smartsku_backend.config import ConfigLoader


class BackendRunner:
    def run(self) -> None:
        config = ConfigLoader().load()
        LoggingConfigurator().configure(config)
        app = ApplicationFactory(config).create()
        uvicorn.run(app, host=config.server.host, port=config.server.port, log_config=None)


if __name__ == "__main__":
    BackendRunner().run()
