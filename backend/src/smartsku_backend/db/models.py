from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import JSON, DateTime, Dialect, Enum, Float, ForeignKey, Integer, String, TypeDecorator, false
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


class Cluster(Base):
    """Boxes joined side by side into one stand; each box stands in a cell of the stand's grid."""

    __tablename__ = "clusters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))


class Box(Base):
    __tablename__ = "boxes"

    COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hardware_id: Mapped[str] = mapped_column(String(64), unique=True)
    online: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))
    status_changed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    # Optional name the user gives the box, e.g. what it holds
    alias: Mapped[str | None] = mapped_column(String(64))
    # Place on the stand, seen from the front: column x from the left, row y from the bottom, both from 0.
    # Null while the box is not placed yet
    cluster_id: Mapped[int | None] = mapped_column(ForeignKey("clusters.id"))
    grid_x: Mapped[int | None] = mapped_column(Integer)
    grid_y: Mapped[int | None] = mapped_column(Integer)

    @property
    def address(self) -> str | None:
        """How people find the box on its stand: column letter and row number, e.g. B1 (rows count bottom up,
        so a box stacked on top does not renumber the ones below)."""
        if self.cluster_id is None or self.grid_x is None or self.grid_y is None:
            return None
        letters = ""
        column = self.grid_x
        while True:
            column, remainder = divmod(column, len(self.COLUMN_LETTERS))
            letters = self.COLUMN_LETTERS[remainder] + letters
            if column == 0:
                break
            column -= 1
        return f"{letters}{self.grid_y + 1}"


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
    # Warn on the dashboard once fewer pieces are left; the box itself does not show it
    low_stock: Mapped[int | None] = mapped_column(Integer)
    calibrated_at: Mapped[datetime] = mapped_column(UtcDateTime)

    def quantity_for(self, weight: float) -> int:
        return max(0, round(weight / self.piece_weight))

    @property
    def running_low(self) -> bool:
        return self.low_stock is not None and self.quantity < self.low_stock


class LockerState(Base):
    """Latest known state of a locker slot (a load cell position inside a box)."""

    __tablename__ = "locker_states"

    box_id: Mapped[str] = mapped_column(ForeignKey("boxes.id"), primary_key=True)
    locker_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nfc_flag: Mapped[bool] = mapped_column(default=False)
    nfc_id: Mapped[str | None] = mapped_column(String(64))
    weight: Mapped[float] = mapped_column(Float, default=0.0)
    quantity: Mapped[int | None] = mapped_column(Integer)
    slot_ready: Mapped[bool] = mapped_column(default=False, server_default=false())
    cell_tared: Mapped[bool] = mapped_column(default=False, server_default=false())
    tag_error: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Calibration the box is walking through: the step it waits for and the portion size
    calibration_step: Mapped[str | None] = mapped_column(String(32))
    calibration_pieces: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # What the inventory journal last recorded for this slot: the cell in it and its quantity. Readings reach the
    # journal only after they hold for telemetry.confirm_seconds, so these lag behind the live fields above.
    logged_nfc_id: Mapped[str | None] = mapped_column(String(64))
    logged_quantity: Mapped[int | None] = mapped_column(Integer)
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
    low_stock: Mapped[int | None] = mapped_column(Integer)
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
    CALIBRATION_FAILED = "calibration_failed"
    SLOT_ZEROED = "slot_zeroed"
    SLOT_SCALED = "slot_scaled"
    CELL_TARED = "cell_tared"
    SCALE_FAILED = "scale_failed"
    # One record per order, not tied to a box: the start and the end (note — what and how many); records of the cells
    # changed during the assembly carry its assembly_id
    ASSEMBLY_STARTED = "assembly_started"
    ASSEMBLY_COMPLETED = "assembly_completed"
    ASSEMBLY_CANCELLED = "assembly_cancelled"


class InventoryEvent(Base):
    """Append-only log of everything that happened to cells, used for inventory accounting."""

    __tablename__ = "inventory_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[InventoryEventType] = mapped_column(Enum(InventoryEventType, native_enum=False, length=32))
    # Null for the records of a whole assembly order
    box_id: Mapped[str | None] = mapped_column(ForeignKey("boxes.id"))
    locker_id: Mapped[int | None] = mapped_column(Integer)
    nfc_id: Mapped[str | None] = mapped_column(String(64))
    component_name: Mapped[str | None] = mapped_column(String(255))
    weight: Mapped[float] = mapped_column(Float)
    quantity_before: Mapped[int | None] = mapped_column(Integer)
    quantity_after: Mapped[int | None] = mapped_column(Integer)
    # Human-readable detail, e.g. why the box could not set up the load cell
    note: Mapped[str | None] = mapped_column(String(255))
    # The assembly the record belongs to: its start and end, and cell records made while it ran
    assembly_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))

    @property
    def quantity_delta(self) -> int | None:
        if self.quantity_before is None or self.quantity_after is None:
            return None
        return self.quantity_after - self.quantity_before


class Specification(Base):
    """A product and the components one piece of it takes, e.g. a table: 20 screws, 10 nuts."""

    __tablename__ = "specifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))


class SpecificationItem(Base):
    """A line of a specification. Components are named, not bound to cells: the same component may lie in several
    cells, and a cell calibrated anew under the same name still fits."""

    __tablename__ = "specification_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    specification_id: Mapped[int] = mapped_column(ForeignKey("specifications.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    component_name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer)


class AssemblyStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Assembly(Base):
    """Picking the components of a specification from the stands; only one runs at a time, since it takes over
    the displays of all boxes."""

    __tablename__ = "assemblies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Null once the specification is deleted; its name stays
    specification_id: Mapped[int | None] = mapped_column(
        ForeignKey("specifications.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    # How many products are assembled at once: every line of the specification is multiplied by it
    kits: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[AssemblyStatus] = mapped_column(
        Enum(AssemblyStatus, native_enum=False, length=16), default=AssemblyStatus.ACTIVE
    )
    started_at: Mapped[datetime] = mapped_column(UtcDateTime, default=lambda: datetime.now(UTC))
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class AssemblyPick(Base):
    """How many pieces to take from one cell. The cell is found by its NFC tag; box_id and locker_id follow it
    if it is put back into another slot."""

    __tablename__ = "assembly_picks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id", ondelete="CASCADE"))
    component_name: Mapped[str] = mapped_column(String(255))
    nfc_id: Mapped[str] = mapped_column(String(64))
    box_id: Mapped[str] = mapped_column(ForeignKey("boxes.id"))
    locker_id: Mapped[int] = mapped_column(Integer)
    # Pieces to take
    quantity: Mapped[int] = mapped_column(Integer)
    # Pieces in the cell when the assembly started: taken = start_quantity - what is there now
    start_quantity: Mapped[int] = mapped_column(Integer)
    # Pieces in the cell when the assembly ended, null while it runs
    final_quantity: Mapped[int | None] = mapped_column(Integer)

    def remaining(self, quantity: int) -> int:
        """Pieces still to take with this many in the cell; negative — taken too many, put them back."""
        return self.quantity - (self.start_quantity - quantity)
