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
    # A removal, an insertion or a new quantity reaches the inventory journal only after it holds this long
    confirm_seconds: float = 3


class ScaleConfig(BaseModel):
    # How long an API request waits for the box to measure (the box itself gives up after ~5 s)
    answer_timeout_seconds: float = 10


class OnboardingConfig(BaseModel):
    # Broker address a box should use; it differs from mqtt.host (the backend's own view, e.g. a Docker hostname).
    # Empty host: the dashboard suggests the address it was opened with
    broker_host: str = ""
    broker_port: int = 1883
    # A box connected from the dashboard must register within this time
    claim_ttl_minutes: float = 30


class LoggingConfig(BaseModel):
    level: str


class AppConfig(BaseModel):
    server: ServerConfig
    database: DatabaseConfig
    mqtt: MqttConfig
    telemetry: TelemetryConfig
    scale: ScaleConfig = ScaleConfig()
    onboarding: OnboardingConfig
    logging: LoggingConfig


class ConfigLoader:
    ENV_VARIABLE = "SMARTSKU_BACKEND_CONFIG"
    DEFAULT_PATH = Path("config/config.local.yaml")

    def load(self) -> AppConfig:
        path = Path(os.environ.get(self.ENV_VARIABLE, self.DEFAULT_PATH))
        with path.open(encoding="utf-8") as file:
            return AppConfig.model_validate(yaml.safe_load(file))
