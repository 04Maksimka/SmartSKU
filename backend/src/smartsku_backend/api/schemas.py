from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from smartsku_backend.db.models import CalibrationStatus, InventoryEventType
from smartsku_backend.messaging.contracts import ScaleAction


class OrmSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BoxSchema(OrmSchema):
    id: str
    hardware_id: str
    online: bool
    created_at: datetime
    status_changed_at: datetime | None
    alias: str | None
    cluster_id: int | None = Field(description="Stand the box is placed on, null while not placed")
    grid_x: int | None = Field(description="Column on the stand from the left, from 0")
    grid_y: int | None = Field(description="Row on the stand from the bottom, from 0")
    address: str | None = Field(description="Column letter and row number on the stand, e.g. B1")


class ClusterSchema(OrmSchema):
    id: int
    name: str


class ClusterRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class BoxRenameRequest(BaseModel):
    alias: str | None = Field(default=None, max_length=64, description="Empty or null removes the name")


class BoxPlacementRequest(BaseModel):
    cluster_id: int | None = Field(description="Null: start a new stand with this box")
    x: int = Field(default=0, description="Column from the left; -1 puts the box left of column A")
    y: int = Field(default=0, description="Row from the bottom; -1 puts the box below row 1")


class BoxClaimRequest(BaseModel):
    hardware_id: str = Field(min_length=1, max_length=64)


class OnboardingSettingsSchema(BaseModel):
    broker_host: str
    broker_port: int
    broker_tls: bool
    broker_username: str
    broker_password: str


class ComponentSchema(OrmSchema):
    nfc_id: str
    name: str
    tags: list[str]
    piece_weight: float
    quantity: int
    calibrated_at: datetime


class CalibrationProgressSchema(BaseModel):
    """Calibration the box is walking through; step names are listed in messaging/contracts.py."""

    step: str
    num_of_pieces: int


class LockerSchema(BaseModel):
    box_id: str
    locker_id: int
    nfc_flag: bool
    nfc_id: str | None
    weight: float = Field(description="Content weight, grams")
    quantity: int | None
    slot_ready: bool = Field(description="The load cell has its zero and scale")
    cell_tared: bool = Field(description="The inserted cell has its empty weight in the NFC tag")
    tag_error: bool = Field(description="The NFC tag of the inserted cell cannot be read")
    calibration: CalibrationProgressSchema | None
    updated_at: datetime
    component: ComponentSchema | None


class ScaleRequest(BaseModel):
    action: ScaleAction
    grams: float | None = Field(default=None, gt=0, description="Reference weight, required for reference")


class ScaleResultSchema(BaseModel):
    action: ScaleAction
    value: float = Field(description="zero: raw reading, reference: counts per gram, cell_tare: grams")
    nfc_id: str | None


class CalibrationRequest(BaseModel):
    box_id: str
    locker_id: int
    name: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    num_of_pieces: int = Field(gt=0)


class CalibrationSchema(OrmSchema):
    id: int
    box_id: str
    locker_id: int
    name: str
    tags: list[str]
    num_of_pieces: int
    status: CalibrationStatus
    nfc_id: str | None
    piece_weight: float | None
    created_at: datetime
    completed_at: datetime | None


class InventoryEventSchema(OrmSchema):
    id: int
    event_type: InventoryEventType
    box_id: str
    locker_id: int
    nfc_id: str | None
    component_name: str | None
    weight: float
    quantity_before: int | None
    quantity_after: int | None
    quantity_delta: int | None
    note: str | None
    created_at: datetime
