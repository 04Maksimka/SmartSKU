import uvicorn

from smartsku_emulator.app import ApplicationFactory, LoggingConfigurator
from smartsku_emulator.config import ConfigLoader


class EmulatorRunner:
    def run(self) -> None:
        config = ConfigLoader().load()
        LoggingConfigurator().configure(config)
        app = ApplicationFactory(config).create()
        uvicorn.run(app, host=config.server.host, port=config.server.port, log_config=None)


if __name__ == "__main__":
    EmulatorRunner().run()
