from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from smartsku_backend.db.models import CalibrationStatus, InventoryEventType


class OrmSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BoxSchema(OrmSchema):
    id: str
    hardware_id: str
    online: bool
    created_at: datetime
    status_changed_at: datetime | None


class BoxClaimRequest(BaseModel):
    hardware_id: str = Field(min_length=1, max_length=64)


class OnboardingSettingsSchema(BaseModel):
    broker_host: str
    broker_port: int


class ComponentSchema(OrmSchema):
    nfc_id: str
    name: str
    tags: list[str]
    piece_weight: float
    quantity: int
    calibrated_at: datetime


class LockerSchema(BaseModel):
    box_id: str
    locker_id: int
    nfc_flag: bool
    nfc_id: str | None
    weight: float
    quantity: int | None
    zeroed: bool
    updated_at: datetime
    component: ComponentSchema | None


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
