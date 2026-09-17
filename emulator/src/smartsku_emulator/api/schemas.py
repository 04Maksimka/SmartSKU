from pydantic import BaseModel, Field


class CellView(BaseModel):
    nfc_id: str
    weight: float


class LockerView(BaseModel):
    locker_id: int
    nfc_flag: bool = Field(description="true: a cell is inserted into this locker")
    cell: CellView | None
    calibrated_piece_weight: float | None
    pending_calibration: int | None
    zeroed: bool = Field(description="false: the slot has no zero yet and reports weight 0")
    led_color: str
    screen_number: int


class BoxView(BaseModel):
    hardware_id: str
    box_id: str | None
    connected: bool
    lockers: list[LockerView]


class CreateBoxRequest(BaseModel):
    hardware_id: str = Field(min_length=1)
    lockers_count: int = Field(default=4, ge=1, le=16)


class InsertCellRequest(BaseModel):
    nfc_id: str


class CreateCellRequest(BaseModel):
    nfc_id: str = Field(min_length=1)


class GramsRequest(BaseModel):
    grams: float = Field(description="Positive: pour into the cell, negative: take out", examples=[50.0])


class PiecesRequest(BaseModel):
    pieces: int = Field(description="Positive: add pieces, negative: take pieces", examples=[-3])
