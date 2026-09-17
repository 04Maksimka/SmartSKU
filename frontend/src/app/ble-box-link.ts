import type { BoxMessage, BoxRequest } from "../api/box-setup-types";

export type MessageListener = (message: BoxMessage) => void;

/**
 * Bluetooth link to a box in setup mode. Works like a UART: JSON lines are written to RX in small chunks and come
 * back as notifications on TX, split by the box to fit the MTU. UUIDs match firmware AppConfig::BLE_*.
 */
export class BleBoxLink {
  static readonly SERVICE_UUID = "6f1c0001-8c5b-4f5e-9a57-5b1e2a8d0c11";
  static readonly RX_UUID = "6f1c0002-8c5b-4f5e-9a57-5b1e2a8d0c11";
  static readonly TX_UUID = "6f1c0003-8c5b-4f5e-9a57-5b1e2a8d0c11";
  static readonly NAME_PREFIX = "SmartSKU-";
  /** Below the default 20-byte payload would be safest, but every browser with Web Bluetooth negotiates more. */
  private static readonly CHUNK_BYTES = 180;

  private device: BluetoothDevice | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private readonly encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private buffer = "";
  private readonly messageListeners = new Set<MessageListener>();
  private readonly disconnectListeners = new Set<() => void>();

  static isSupported(): boolean {
    return navigator.bluetooth !== undefined;
  }

  get deviceName(): string {
    return this.device?.name ?? "";
  }

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  /** Opens the browser's device chooser; must be called from a click handler. */
  async choose(): Promise<void> {
    const bluetooth = navigator.bluetooth;
    if (bluetooth === undefined) {
      throw new Error("Браузер не поддерживает Bluetooth. Откройте страницу в Google Chrome или Microsoft Edge.");
    }
    this.disconnect();
    this.device = await bluetooth.requestDevice({
      filters: [{ services: [BleBoxLink.SERVICE_UUID] }, { namePrefix: BleBoxLink.NAME_PREFIX }],
      optionalServices: [BleBoxLink.SERVICE_UUID],
    });
    this.device.addEventListener("gattserverdisconnected", this.handleDisconnected);
    await this.connect();
  }

  /** Connects to the already chosen device again, e.g. after the box closed the link. */
  async connect(): Promise<void> {
    const gatt = this.device?.gatt;
    if (gatt === undefined) {
      throw new Error("Бокс не выбран");
    }
    const server = await gatt.connect();
    const service = await server.getPrimaryService(BleBoxLink.SERVICE_UUID);
    this.rx = await service.getCharacteristic(BleBoxLink.RX_UUID);
    this.tx = await service.getCharacteristic(BleBoxLink.TX_UUID);
    this.decoder = new TextDecoder();
    this.buffer = "";
    this.tx.addEventListener("characteristicvaluechanged", this.handleNotification);
    await this.tx.startNotifications();
  }

  disconnect(): void {
    this.tx?.removeEventListener("characteristicvaluechanged", this.handleNotification);
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnected);
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.rx = null;
    this.tx = null;
  }

  async send(request: BoxRequest): Promise<void> {
    if (this.rx === null || !this.connected) {
      throw new Error("Нет связи с боксом по Bluetooth");
    }
    const bytes = this.encoder.encode(`${JSON.stringify(request)}\n`);
    for (let offset = 0; offset < bytes.length; offset += BleBoxLink.CHUNK_BYTES) {
      await this.rx.writeValueWithResponse(bytes.slice(offset, offset + BleBoxLink.CHUNK_BYTES));
    }
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private readonly handleNotification = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value === undefined) {
      return;
    }
    this.buffer += this.decoder.decode(value, { stream: true });
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.dispatch(line);
      newline = this.buffer.indexOf("\n");
    }
  };

  private readonly handleDisconnected = (): void => {
    for (const listener of this.disconnectListeners) {
      listener();
    }
  };

  private dispatch(line: string): void {
    let message: BoxMessage;
    try {
      message = JSON.parse(line) as BoxMessage;
    } catch {
      return;
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}
