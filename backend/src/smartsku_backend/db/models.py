from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import JSON, DateTime, Dialect, Enum, Float, ForeignKey, Integer, String, TypeDecorator, true
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UtcDateTime(TypeDecorator[datetime]):
    """SQLite drops timezone info; values are stored as naive UTC and returned as aware UTC."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        return value.astimezone(UTC).replace(tzinfo=None) if value is not None else None

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None else None


class Box(Base):
    __tablename__ = "boxes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hardware_id: Mapped[str] = mapped_column(String(64), unique=True)
    online: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))
    status_changed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class BoxClaim(Base):
    """A box the user is connecting from the dashboard; only claimed hardware may register as a new box."""

    __tablename__ = "box_claims"

    hardware_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))


class Component(Base):
    """What is stored in a physical cell. Keyed by the cell's NFC tag, so it follows the cell between lockers."""

    __tablename__ = "components"

    nfc_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    piece_weight: Mapped[float] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    calibrated_at: Mapped[datetime] = mapped_column(UtcDateTime)

    def quantity_for(self, weight: float) -> int:
        return max(0, round(weight / self.piece_weight))


class LockerState(Base):
    """Latest known state of a locker slot (a load cell position inside a box)."""

    __tablename__ = "locker_states"

    box_id: Mapped[str] = mapped_column(ForeignKey("boxes.id"), primary_key=True)
    locker_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nfc_flag: Mapped[bool] = mapped_column(default=False)
    nfc_id: Mapped[str | None] = mapped_column(String(64))
    weight: Mapped[float] = mapped_column(Float, default=0.0)
    reported_piece_weight: Mapped[float] = mapped_column(Float, default=0.0)
    quantity: Mapped[int | None] = mapped_column(Integer)
    zeroed: Mapped[bool] = mapped_column(default=True, server_default=true())
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))


class CalibrationStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Calibration(Base):
    __tablename__ = "calibrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    box_id: Mapped[str] = mapped_column(ForeignKey("boxes.id"))
    locker_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(255))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    num_of_pieces: Mapped[int] = mapped_column(Integer)
    status: Mapped[CalibrationStatus] = mapped_column(
        Enum(CalibrationStatus, native_enum=False, length=16), default=CalibrationStatus.PENDING
    )
    nfc_id: Mapped[str | None] = mapped_column(String(64))
    piece_weight: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class InventoryEventType(StrEnum):
    CELL_REMOVED = "cell_removed"
    CELL_INSERTED = "cell_inserted"
    QUANTITY_CHANGED = "quantity_changed"
    CALIBRATED = "calibrated"


class InventoryEvent(Base):
    """Append-only log of everything that happened to cells, used for inventory accounting."""

    __tablename__ = "inventory_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[InventoryEventType] = mapped_column(Enum(InventoryEventType, native_enum=False, length=32))
    box_id: Mapped[str] = mapped_column(ForeignKey("boxes.id"))
    locker_id: Mapped[int] = mapped_column(Integer)
    nfc_id: Mapped[str | None] = mapped_column(String(64))
    component_name: Mapped[str | None] = mapped_column(String(255))
    weight: Mapped[float] = mapped_column(Float)
    quantity_before: Mapped[int | None] = mapped_column(Integer)
    quantity_after: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))

    @property
    def quantity_delta(self) -> int | None:
        if self.quantity_before is None or self.quantity_after is None:
            return None
        return self.quantity_after - self.quantity_before
