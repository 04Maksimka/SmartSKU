import os
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class ServerConfig(BaseModel):
    host: str
    port: int


class MqttConfig(BaseModel):
    host: str
    port: int
    topic_prefix: str
    reconnect_interval_seconds: float
    keepalive_seconds: int
    provision_timeout_seconds: float


class CellSeed(BaseModel):
    nfc_id: str


class InsertedCellSeed(CellSeed):
    locker_id: int


class BoxSeed(BaseModel):
    hardware_id: str
    lockers_count: int = 4
    cells: list[InsertedCellSeed] = Field(default_factory=list)


class EmulatorConfig(BaseModel):
    server: ServerConfig
    mqtt: MqttConfig
    publish_interval_seconds: float
    weight_noise_grams: float
    identity_store_path: Path
    boxes: list[BoxSeed]
    loose_cells: list[CellSeed] = Field(default_factory=list)
    log_level: str = "INFO"


class ConfigLoader:
    ENV_VARIABLE = "SMARTSKU_EMULATOR_CONFIG"
    DEFAULT_PATH = Path("config/config.local.yaml")

    def load(self) -> EmulatorConfig:
        path = Path(os.environ.get(self.ENV_VARIABLE, self.DEFAULT_PATH))
        with path.open(encoding="utf-8") as file:
            return EmulatorConfig.model_validate(yaml.safe_load(file))
