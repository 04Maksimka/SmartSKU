import type { ApiClient } from "../api/client";
import type { Box, Calibration, Component, InventoryEvent, Locker } from "../api/types";
import type { AppConfig } from "../config/app-config";

export interface LockerOverview {
  locker: Locker;
  boxName: string;
  pendingCalibration: Calibration | null;
  /** Latest pull-out from this locker: tells which cell is missing while the locker is empty. */
  lastRemoval: InventoryEvent | null;
}

export interface BoxOverview {
  box: Box;
  lockers: LockerOverview[];
}

export interface ComponentOverview {
  component: Component;
  /** Locker the cell is inserted into, null while the cell is pulled out. */
  location: LockerOverview | null;
}

export interface DashboardSnapshot {
  boxes: BoxOverview[];
  components: ComponentOverview[];
  calibrations: Calibration[];
  events: InventoryEvent[];
  boxNames: Map<string, string>;
  updatedAt: Date | null;
  error: string | null;
}

export type SnapshotListener = (snapshot: DashboardSnapshot) => void;

/** Polls the backend and turns raw API lists into ready-to-render views. */
export class DashboardStore {
  private readonly listeners = new Set<SnapshotListener>();
  private snapshot: DashboardSnapshot = {
    boxes: [],
    components: [],
    calibrations: [],
    events: [],
    boxNames: new Map(),
    updatedAt: null,
    error: null,
  };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;

  constructor(
    private readonly api: ApiClient,
    private readonly config: AppConfig,
  ) {}

  get current(): DashboardSnapshot {
    return this.snapshot;
  }

  get refreshIntervalMs(): number {
    return this.config.refreshIntervalMs;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Pulls fresh data right away, e.g. after the user changed something. */
  async refreshNow(): Promise<void> {
    await this.tick();
  }

  start(): void {
    document.addEventListener("visibilitychange", this.handleVisibility);
    void this.tick();
  }

  private readonly handleVisibility = (): void => {
    if (!document.hidden) {
      void this.tick();
    }
  };

  private async tick(): Promise<void> {
    clearTimeout(this.timer);
    if (!document.hidden && !this.inFlight) {
      this.inFlight = true;
      try {
        await this.refresh();
      } finally {
        this.inFlight = false;
      }
    }
    this.timer = setTimeout(() => void this.tick(), this.config.refreshIntervalMs);
  }

  private async refresh(): Promise<void> {
    try {
      const [boxes, lockers, components, calibrations, events] = await Promise.all([
        this.api.boxes(),
        this.api.lockers(),
        this.api.components(),
        this.api.calibrations(),
        this.api.events(this.config.eventsLimit),
      ]);
      this.snapshot = this.build(boxes, lockers, components, calibrations, events);
    } catch (error) {
      this.snapshot = { ...this.snapshot, error: error instanceof Error ? error.message : String(error) };
    }
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private build(
    boxes: Box[],
    lockers: Locker[],
    components: Component[],
    calibrations: Calibration[],
    events: InventoryEvent[],
  ): DashboardSnapshot {
    const boxNames = new Map(boxes.map((box) => [box.id, box.hardware_id]));
    const newestFirst = [...calibrations].sort((left, right) => right.id - left.id);
    const overviews = lockers.map<LockerOverview>((locker) => ({
      locker,
      boxName: boxNames.get(locker.box_id) ?? locker.box_id,
      pendingCalibration:
        newestFirst.find(
          (item) => item.status === "pending" && item.box_id === locker.box_id && item.locker_id === locker.locker_id,
        ) ?? null,
      lastRemoval: locker.nfc_flag
        ? null
        : (events.find(
            (event) =>
              event.event_type === "cell_removed" &&
              event.box_id === locker.box_id &&
              event.locker_id === locker.locker_id,
          ) ?? null),
    }));

    return {
      boxes: boxes.map((box) => ({
        box,
        lockers: overviews
          .filter((item) => item.locker.box_id === box.id)
          .sort((left, right) => left.locker.locker_id - right.locker.locker_id),
      })),
      components: components.map((component) => ({
        component,
        location:
          overviews.find((item) => item.locker.nfc_flag && item.locker.nfc_id === component.nfc_id) ?? null,
      })),
      calibrations: newestFirst.slice(0, this.config.calibrationsLimit),
      events,
      boxNames,
      updatedAt: new Date(),
      error: null,
    };
  }
}
