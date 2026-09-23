import os
from pathlib import Path
from typing import Any

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
    # Empty: anonymous (local broker). The cloud broker requires a login, the password comes from the secrets file
    username: str = ""
    password: str = ""


class TelemetryConfig(BaseModel):
    weight_change_threshold: float
    # An insertion or a new quantity reaches the inventory journal only after it holds this long
    confirm_seconds: float = 3
    # A removal: the box already needs ~0.6 s without the tag, this only filters out a flickering tag
    removal_confirm_seconds: float = 1


class ScaleConfig(BaseModel):
    # How long an API request waits for the box to measure (the box itself gives up after ~5 s)
    answer_timeout_seconds: float = 10


class OnboardingConfig(BaseModel):
    # Broker address a box should use; it differs from mqtt.host (the backend's own view, e.g. a Docker hostname).
    # Empty host: the dashboard suggests the address it was opened with
    broker_host: str = ""
    broker_port: int = 1883
    # Cloud broker: TLS and the account a box logs in with; the dashboard hands them to the box over Bluetooth
    broker_tls: bool = False
    box_username: str = ""
    box_password: str = ""
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
    """Reads the yaml config and, if SMARTSKU_BACKEND_SECRETS is set, merges a secrets yaml of the same shape over it
    (passwords stay out of git)."""

    ENV_VARIABLE = "SMARTSKU_BACKEND_CONFIG"
    SECRETS_ENV_VARIABLE = "SMARTSKU_BACKEND_SECRETS"
    DEFAULT_PATH = Path("config/config.local.yaml")

    def load(self) -> AppConfig:
        data = self._read(Path(os.environ.get(self.ENV_VARIABLE, self.DEFAULT_PATH)))
        secrets_path = os.environ.get(self.SECRETS_ENV_VARIABLE)
        if secrets_path:
            data = self._merge(data, self._read(Path(secrets_path)))
        return AppConfig.model_validate(data)

    def _read(self, path: Path) -> dict[str, Any]:
        with path.open(encoding="utf-8") as file:
            return yaml.safe_load(file) or {}

    def _merge(self, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        merged = dict(base)
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._merge(merged[key], value)
            else:
                merged[key] = value
        return merged
