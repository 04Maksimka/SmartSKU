import type { EmulatorClient } from "../api/emulator-client";
import type { EmulatorBox, EmulatorCell } from "../api/emulator-types";

export interface EmulatorSnapshot {
  boxes: EmulatorBox[];
  looseCells: EmulatorCell[];
  updatedAt: Date | null;
  error: string | null;
}

export type EmulatorListener = (snapshot: EmulatorSnapshot) => void;

/** Polls the emulator only while its tab is open: without the emulator profile there is nothing to poll. */
export class EmulatorStore {
  private readonly listeners = new Set<EmulatorListener>();
  private snapshot: EmulatorSnapshot = { boxes: [], looseCells: [], updatedAt: null, error: null };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inFlight = false;

  constructor(
    private readonly api: EmulatorClient,
    private readonly intervalMs: number,
  ) {}

  subscribe(listener: EmulatorListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.running) {
      this.running = true;
      void this.tick();
    }
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  async refreshNow(): Promise<void> {
    await this.refresh();
  }

  private async tick(): Promise<void> {
    clearTimeout(this.timer);
    if (!document.hidden) {
      await this.refresh();
    }
    if (this.running) {
      this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }

  private async refresh(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const [boxes, looseCells] = await Promise.all([this.api.boxes(), this.api.looseCells()]);
      this.snapshot = { boxes, looseCells, updatedAt: new Date(), error: null };
    } catch (error) {
      this.snapshot = { ...this.snapshot, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.inFlight = false;
    }
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}
