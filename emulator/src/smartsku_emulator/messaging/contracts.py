from typing import Literal

from pydantic import BaseModel


class LockerReading(BaseModel):
    locker_id: int
    nfc_flag: bool
    nfc_id: str
    weight: float
    piece_weight: float
    number_of_pieces: int
    zeroed: bool


class BoxDataMessage(BaseModel):
    box_id: str
    lockers: list[LockerReading]


class CalibrationCommand(BaseModel):
    command: Literal["calibration"]
    box_id: str
    locker_id: int
    num_of_pieces: int


class TareCommand(BaseModel):
    command: Literal["tare"]
    box_id: str
    locker_id: int


class IndicatorsCommand(BaseModel):
    command: Literal["indicators"]
    box_id: str
    locker_id: int
    led_color: str
    screen_number: int


class ProvisionRequest(BaseModel):
    hardware_id: str


class ProvisionResponse(BaseModel):
    hardware_id: str
    box_id: str
