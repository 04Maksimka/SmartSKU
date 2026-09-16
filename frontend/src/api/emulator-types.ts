// Mirrors emulator/src/smartsku_emulator/api/schemas.py

export interface EmulatorCell {
  nfc_id: string;
  weight: number;
}

export interface EmulatorLocker {
  locker_id: number;
  nfc_flag: boolean;
  cell: EmulatorCell | null;
  calibrated_piece_weight: number | null;
  pending_calibration: number | null;
  led_color: string;
  screen_number: number;
}

export interface EmulatorBox {
  hardware_id: string;
  box_id: string | null;
  connected: boolean;
  lockers: EmulatorLocker[];
}
