from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator


class ScreenMode(StrEnum):
    """What the slot display shows from an indicators command (see firmware CountDisplay.h)."""

    # The piece count; screen_number null: dashes (no cell, or it is not counted)
    COUNT = "count"
    # Blank: the slot has nothing to do with the running assembly
    OFF = "off"
    # "t" and screen_number: take this many pieces for the assembly
    TAKE = "take"
    # "P" and screen_number: too many were taken, put this many back
    PUT = "put"


class CalibrationStep(StrEnum):
    """Steps the box walks through by itself during a calibration, watching NFC and the load cell."""

    REMOVE_CELL = "remove_cell"
    INSERT_FILLED = "insert_filled"
    MEASURE_PIECES = "measure_pieces"


class CalibrationProgress(BaseModel):
    step: CalibrationStep
    num_of_pieces: int = 0


class LockerReading(BaseModel):
    locker_id: int
    nfc_flag: bool
    nfc_id: str | None = None
    # Content weight in grams: without the cell's own weight (tare)
    weight: float
    # Grams, from the cell's NFC tag
    piece_weight: float
    number_of_pieces: int
    # The load cell has its zero and scale (set up with the reference weight)
    slot_ready: bool = False
    # The inserted cell has its tare in the NFC tag
    cell_tared: bool = False
    # The tag of the inserted cell cannot be read or written
    tag_error: bool = False
    calibration: CalibrationProgress | None = None

    @field_validator("nfc_id")
    @classmethod
    def empty_nfc_id_is_none(cls, value: str | None) -> str | None:
        return value or None

    @property
    def measurable(self) -> bool:
        """Weight means something only for a tared cell in a ready slot, and not while a calibration moves it."""
        return self.nfc_flag and self.slot_ready and self.cell_tared and self.calibration is None


class BoxDataMessage(BaseModel):
    box_id: str
    lockers: list[LockerReading]


class CalibrationCommand(BaseModel):
    command: Literal["calibration"] = "calibration"
    box_id: str
    locker_id: int
    num_of_pieces: int = Field(gt=0)


class ScaleAction(StrEnum):
    """Load cell setup, one measurement of a settled weight each (see firmware Locker.h)."""

    # The cell is pulled out, nothing on the slot
    ZERO = "zero"
    # The reference weight on the zeroed empty slot: counts per gram, its sign is the load cell direction
    REFERENCE = "reference"
    # The inserted cell is empty: its weight goes to its NFC tag
    CELL_TARE = "cell_tare"


class ScaleCommand(BaseModel):
    command: Literal["scale"] = "scale"
    box_id: str
    locker_id: int
    action: ScaleAction
    # Reference weight, only for REFERENCE
    grams: float | None = None


class CancelCommand(BaseModel):
    """Stops a calibration the box is walking through."""

    command: Literal["cancel"] = "cancel"
    box_id: str
    locker_id: int


class ScaleDoneEvent(BaseModel):
    event: Literal["scale_done"]
    box_id: str
    locker_id: int
    action: ScaleAction
    # ZERO: raw reading, REFERENCE: counts per gram, CELL_TARE: grams written to the tag
    value: float
    nfc_id: str | None = None


class ScaleFailedEvent(BaseModel):
    event: Literal["scale_failed"]
    box_id: str
    locker_id: int
    action: ScaleAction
    reason: str


class CalibrationDoneEvent(BaseModel):
    event: Literal["calibration_done"]
    box_id: str
    locker_id: int
    nfc_id: str
    # Grams
    piece_weight: float
    # Weight of the calibration portion, grams
    weight: float


class CalibrationFailedEvent(BaseModel):
    event: Literal["calibration_failed"]
    box_id: str
    locker_id: int
    reason: str


BoxEvent = Annotated[
    ScaleDoneEvent | ScaleFailedEvent | CalibrationDoneEvent | CalibrationFailedEvent, Field(discriminator="event")
]


class IndicatorsCommand(BaseModel):
    command: Literal["indicators"] = "indicators"
    box_id: str
    locker_id: int
    # None: the display shows dashes (no cell, or the cell has no tare or is not calibrated)
    screen_number: int | None
    # Firmware before 0.9.0 ignores it and shows screen_number (dashes for OFF)
    screen_mode: ScreenMode = ScreenMode.COUNT


class ProvisionRequest(BaseModel):
    hardware_id: str


class ProvisionResponse(BaseModel):
    hardware_id: str
    box_id: str
