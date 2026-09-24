from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from smartsku_backend.db.models import AssemblyStatus, CalibrationStatus, InventoryEventType
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
    assembly_id: int | None
    created_at: datetime


class SpecificationItemSchema(OrmSchema):
    component_name: str = Field(min_length=1, max_length=255)
    quantity: int = Field(gt=0, description="Pieces for one product")


class SpecificationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    items: list[SpecificationItemSchema] = Field(min_length=1)


class SpecificationSchema(BaseModel):
    id: int
    name: str
    items: list[SpecificationItemSchema]
    created_at: datetime
    updated_at: datetime


class StockCellSchema(BaseModel):
    box_id: str
    locker_id: int
    nfc_id: str
    quantity: int


class ItemAvailabilitySchema(BaseModel):
    component_name: str
    required: int
    available: int = Field(description="Pieces in cells the displays can guide to: inserted, box on line, counted")
    missing: int
    elsewhere: int = Field(description="Pieces in cells of this component that cannot be used now")
    cells: list[StockCellSchema] = Field(description="Cells to take from, the fullest first")


class AvailabilitySchema(BaseModel):
    specification_id: int
    name: str
    kits: int
    ok: bool
    items: list[ItemAvailabilitySchema]


class AssemblyRequest(BaseModel):
    specification_id: int
    kits: int = Field(default=1, gt=0, le=1000, description="How many products to assemble at once")


class AssemblyPickSchema(BaseModel):
    component_name: str
    nfc_id: str
    box_id: str = Field(description="Where the cell is; follows it into another slot")
    locker_id: int
    quantity: int = Field(description="Pieces to take")
    start_quantity: int
    current_quantity: int
    taken: int
    remaining: int = Field(description="Still to take; negative — taken too many, put back")
    inserted: bool = Field(description="The cell is in its slot")


class AssemblySchema(BaseModel):
    id: int
    specification_id: int | None
    name: str
    kits: int
    status: AssemblyStatus
    started_at: datetime
    finished_at: datetime | None
    picks: list[AssemblyPickSchema]
