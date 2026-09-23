// Mirrors the Bluetooth setup protocol of firmware/smartsku_box/SetupController.h

export type WifiAuth = "open" | "password" | "enterprise";

export interface BoxLockerHardware {
  locker_id: number;
  load_cell: boolean;
  nfc_reader: boolean;
  display: boolean;
  led: boolean;
  /** The box knows the empty slot reading and the load cell direction. */
  slot_ready: boolean;
  /** NFC tag of the inserted cell, empty when the slot is empty. */
  cell: string;
}

export interface BoxInfoMessage {
  type: "info";
  hardware_id: string;
  firmware: string;
  box_id: string;
  wifi: { ssid: string; username: string; connected: boolean; ip?: string; rssi?: number };
  server: { host: string; port: number; connected: boolean };
  lockers: BoxLockerHardware[];
}

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  auth: WifiAuth;
}

export interface NetworksMessage {
  type: "networks";
  items: WifiNetwork[];
}

export type SetupState =
  | "wifi_connecting"
  | "wifi_failed"
  | "server_connecting"
  | "server_failed"
  | "registering"
  | "registered";

export interface StatusMessage {
  type: "status";
  state: SetupState;
  reason?: number;
  message?: string;
  ip?: string;
  host?: string;
  error?: number;
  box_id?: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type BoxMessage = BoxInfoMessage | NetworksMessage | StatusMessage | ErrorMessage;

export interface ConnectRequest {
  op: "connect";
  ssid: string;
  username: string;
  password: string;
  host: string;
  port: number;
}

export type BoxRequest = { op: "info" } | { op: "scan" } | ConnectRequest;

export interface OnboardingSettings {
  broker_host: string;
  broker_port: number;
}
