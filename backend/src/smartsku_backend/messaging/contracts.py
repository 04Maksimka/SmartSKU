from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator


class LedColor(StrEnum):
    RED = "red"
    GREEN = "green"
    NONE = "none"


class LockerReading(BaseModel):
    locker_id: int
    nfc_flag: bool
    nfc_id: str | None = None
    weight: float
    piece_weight: float
    number_of_pieces: int
    # False until the slot's zero (empty cell weight) is set; weight is meaningless until then
    zeroed: bool = True

    @field_validator("nfc_id")
    @classmethod
    def empty_nfc_id_is_none(cls, value: str | None) -> str | None:
        return value or None


class BoxDataMessage(BaseModel):
    box_id: str
    lockers: list[LockerReading]


class CalibrationCommand(BaseModel):
    command: Literal["calibration"] = "calibration"
    box_id: str
    locker_id: int
    num_of_pieces: int = Field(gt=0)


class TareCommand(BaseModel):
    command: Literal["tare"] = "tare"
    box_id: str
    locker_id: int


class TareDoneEvent(BaseModel):
    event: Literal["tare_done"]
    box_id: str
    locker_id: int
    nfc_id: str | None = None
    # New zero in the box's weight units (raw load cell reading with the empty cell)
    tare: float

    @field_validator("nfc_id")
    @classmethod
    def empty_nfc_id_is_none(cls, value: str | None) -> str | None:
        return value or None


class TareFailedEvent(BaseModel):
    event: Literal["tare_failed"]
    box_id: str
    locker_id: int
    # no_cell | load_cell_failed
    reason: str


BoxEvent = Annotated[TareDoneEvent | TareFailedEvent, Field(discriminator="event")]


class IndicatorsCommand(BaseModel):
    command: Literal["indicators"] = "indicators"
    box_id: str
    locker_id: int
    led_color: LedColor
    screen_number: int


class ProvisionRequest(BaseModel):
    hardware_id: str


class ProvisionResponse(BaseModel):
    hardware_id: str
    box_id: str
