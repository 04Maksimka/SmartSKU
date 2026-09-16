// Mirrors backend/src/smartsku_backend/api/schemas.py

export interface Box {
  id: string;
  hardware_id: string;
  online: boolean;
  created_at: string;
  status_changed_at: string | null;
}

export interface Component {
  nfc_id: string;
  name: string;
  tags: string[];
  piece_weight: number;
  quantity: number;
  calibrated_at: string;
}

export interface Locker {
  box_id: string;
  locker_id: number;
  nfc_flag: boolean;
  nfc_id: string | null;
  weight: number;
  quantity: number | null;
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

export type InventoryEventType = "cell_removed" | "cell_inserted" | "quantity_changed" | "calibrated";

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
  created_at: string;
}
