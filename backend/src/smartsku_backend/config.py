import os
from pathlib import Path

import yaml
from pydantic import BaseModel


class ServerConfig(BaseModel):
    host: str
    port: int


class DatabaseConfig(BaseModel):
    path: Path
    busy_timeout_seconds: float
    echo: bool = False

    @property
    def url(self) -> str:
        return f"sqlite+aiosqlite:///{self.path}"


class MqttConfig(BaseModel):
    host: str
    port: int
    client_id: str
    topic_prefix: str
    reconnect_interval_seconds: float
    keepalive_seconds: int


class TelemetryConfig(BaseModel):
    weight_change_threshold: float


class LoggingConfig(BaseModel):
    level: str


class AppConfig(BaseModel):
    server: ServerConfig
    database: DatabaseConfig
    mqtt: MqttConfig
    telemetry: TelemetryConfig
    logging: LoggingConfig


class ConfigLoader:
    ENV_VARIABLE = "SMARTSKU_BACKEND_CONFIG"
    DEFAULT_PATH = Path("config/config.local.yaml")

    def load(self) -> AppConfig:
        path = Path(os.environ.get(self.ENV_VARIABLE, self.DEFAULT_PATH))
        with path.open(encoding="utf-8") as file:
            return AppConfig.model_validate(yaml.safe_load(file))
