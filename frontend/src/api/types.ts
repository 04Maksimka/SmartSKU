// Mirrors backend/src/smartsku_backend/api/schemas.py

export interface Box {
  id: string;
  hardware_id: string;
  online: boolean;
  created_at: string;
  status_changed_at: string | null;
  /** Optional name the user gave the box. */
  alias: string | null;
  /** Stand the box is placed on, null while it is not placed. */
  cluster_id: number | null;
  /** Column on the stand from the left, from 0. */
  grid_x: number | null;
  /** Row on the stand from the bottom, from 0. */
  grid_y: number | null;
  /** Column letter and row number on the stand, e.g. B1. */
  address: string | null;
}

/** Boxes joined side by side into one stand. */
export interface Cluster {
  id: number;
  name: string;
}

export interface Component {
  nfc_id: string;
  name: string;
  tags: string[];
  piece_weight: number;
  quantity: number;
  calibrated_at: string;
}

/** Steps the box reports while it walks through a calibration, see firmware Locker.h. */
export type CalibrationStep = "remove_cell" | "insert_filled" | "measure_pieces";

export interface CalibrationProgress {
  step: CalibrationStep;
  num_of_pieces: number;
}

/** Load cell setup, one measurement each: see backend messaging/contracts.py ScaleAction. */
export type ScaleAction = "zero" | "reference" | "cell_tare";

export interface ScaleResult {
  action: ScaleAction;
  /** zero: raw reading, reference: counts per gram, cell_tare: grams written to the tag. */
  value: number;
  nfc_id: string | null;
}

export interface Locker {
  box_id: string;
  locker_id: number;
  nfc_flag: boolean;
  nfc_id: string | null;
  /** Content weight, grams. */
  weight: number;
  quantity: number | null;
  /** The load cell has its zero and scale (set up with the reference weight). */
  slot_ready: boolean;
  /** The inserted cell has its empty weight in its NFC tag; weight and quantity are counted only then. */
  cell_tared: boolean;
  /** The NFC tag of the inserted cell cannot be read. */
  tag_error: boolean;
  /** Calibration the box is walking through right now. */
  calibration: CalibrationProgress | null;
  updated_at: string;
  component: Component | null;
}

export type CalibrationStatus = "pending" | "completed" | "cancelled";

export interface Calibration {
  id: number;
  box_id: string;
  locker_id: number;
  name: string;
  tags: string[];
  num_of_pieces: number;
  status: CalibrationStatus;
  nfc_id: string | null;
  piece_weight: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface CalibrationRequest {
  box_id: string;
  locker_id: number;
  name: string;
  tags: string[];
  num_of_pieces: number;
}

export type InventoryEventType =
  | "cell_removed"
  | "cell_inserted"
  | "quantity_changed"
  | "calibrated"
  | "calibration_failed"
  | "slot_zeroed"
  | "slot_scaled"
  | "cell_tared"
  | "scale_failed"
  | "assembly_started"
  | "assembly_completed"
  | "assembly_cancelled";

export interface InventoryEvent {
  id: number;
  event_type: InventoryEventType;
  box_id: string;
  locker_id: number;
  nfc_id: string | null;
  component_name: string | null;
  weight: number;
  quantity_before: number | null;
  quantity_after: number | null;
  quantity_delta: number | null;
  /** Detail such as why the box could not set up the load cell. */
  note: string | null;
  /** The assembly a start or end record belongs to. */
  assembly_id: number | null;
  created_at: string;
}

/** A line of a specification: components are named, the same one may lie in several cells. */
export interface SpecificationItem {
  component_name: string;
  /** Pieces for one product. */
  quantity: number;
}

/** A product and the components one piece of it takes. */
export interface Specification {
  id: number;
  name: string;
  items: SpecificationItem[];
  created_at: string;
  updated_at: string;
}

export interface SpecificationRequest {
  name: string;
  items: SpecificationItem[];
}

export interface StockCell {
  box_id: string;
  locker_id: number;
  nfc_id: string;
  quantity: number;
}

export interface ItemAvailability {
  component_name: string;
  required: number;
  /** Pieces in cells the displays can guide to: inserted, box on line, counted. */
  available: number;
  missing: number;
  /** Pieces of this component in cells that cannot be used now: pulled out, box off line, not counted. */
  elsewhere: number;
  /** Cells an assembly takes from, the fullest first. */
  cells: StockCell[];
}

export interface Availability {
  specification_id: number;
  name: string;
  kits: number;
  ok: boolean;
  items: ItemAvailability[];
}

export type AssemblyStatus = "active" | "completed" | "cancelled";

/** How many pieces to take from one cell; box_id and locker_id follow the cell into another slot. */
export interface AssemblyPick {
  component_name: string;
  nfc_id: string;
  box_id: string;
  locker_id: number;
  /** Pieces to take. */
  quantity: number;
  start_quantity: number;
  current_quantity: number;
  taken: number;
  /** Still to take; negative — taken too many, put back. */
  remaining: number;
  /** The cell is in its slot. */
  inserted: boolean;
}

export interface Assembly {
  id: number;
  specification_id: number | null;
  name: string;
  /** How many products are assembled at once. */
  kits: number;
  status: AssemblyStatus;
  started_at: string;
  finished_at: string | null;
  picks: AssemblyPick[];
}
