import type { ApiClient } from "../api/client";
import type {
  Assembly,
  AssemblyPick,
  Box,
  Calibration,
  Cluster,
  Component,
  InventoryEvent,
  Locker,
  Specification,
} from "../api/types";
import type { AppConfig } from "../config/app-config";

export interface LockerOverview {
  locker: Locker;
  boxName: string;
  pendingCalibration: Calibration | null;
  /** Latest pull-out from this locker: tells which cell is missing while the locker is empty. */
  lastRemoval: InventoryEvent | null;
  /** Set while an assembly runs: the slot's task, or no task — its display is dark. */
  assembly: SlotAssembly | null;
}

/** What the running assembly asks of a slot, as its display shows it (backend IndicatorPolicy). */
export interface SlotAssembly {
  assembly: Assembly;
  /** The cell of this slot to take from; null — nothing to do here. */
  pick: AssemblyPick | null;
}

export interface BoxOverview {
  box: Box;
  /** How people call the box: its address on the stand (B1), or its hardware id while it is not placed. */
  name: string;
  lockers: LockerOverview[];
  /** Slots per row, as in the physical box. */
  columns: number;
}

/** A stand of joined boxes, laid out like it stands, seen from the front. */
export interface ClusterOverview {
  cluster: Cluster;
  boxes: BoxOverview[];
}

export interface ComponentOverview {
  component: Component;
  /** Locker the cell is inserted into, null while the cell is pulled out. */
  location: LockerOverview | null;
}

export interface DashboardSnapshot {
  boxes: BoxOverview[];
  clusters: ClusterOverview[];
  /** Boxes that are registered but not placed on a stand yet. */
  unplaced: BoxOverview[];
  components: ComponentOverview[];
  calibrations: Calibration[];
  events: InventoryEvent[];
  specifications: Specification[];
  /** Newest first. */
  assemblies: Assembly[];
  /** The assembly that runs now: it takes over the displays of all boxes. */
  activeAssembly: Assembly | null;
  /** Names of calibrated components, each once: what a specification can ask for. */
  componentNames: string[];
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
    clusters: [],
    unplaced: [],
    components: [],
    calibrations: [],
    events: [],
    specifications: [],
    assemblies: [],
    activeAssembly: null,
    componentNames: [],
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
      const [boxes, clusters, lockers, components, calibrations, events, specifications, assemblies] =
        await Promise.all([
          this.api.boxes(),
          this.api.clusters(),
          this.api.lockers(),
          this.api.components(),
          this.api.calibrations(),
          this.api.events(this.config.eventsLimit),
          this.api.specifications(),
          this.api.assemblies(this.config.assembliesLimit),
        ]);
      this.snapshot = {
        ...this.build(boxes, clusters, lockers, components, calibrations, events, assemblies),
        specifications,
      };
    } catch (error) {
      this.snapshot = { ...this.snapshot, error: error instanceof Error ? error.message : String(error) };
    }
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private build(
    boxes: Box[],
    clusters: Cluster[],
    lockers: Locker[],
    components: Component[],
    calibrations: Calibration[],
    events: InventoryEvent[],
    assemblies: Assembly[],
  ): DashboardSnapshot {
    const activeAssembly = assemblies.find((item) => item.status === "active") ?? null;
    const boxNames = new Map(boxes.map((box) => [box.id, this.boxName(box, clusters)]));
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
      assembly: activeAssembly ? { assembly: activeAssembly, pick: this.pickOf(activeAssembly, locker) } : null,
    }));

    const boxOverviews = boxes.map<BoxOverview>((box) => ({
      box,
      name: boxNames.get(box.id) ?? box.id,
      lockers: overviews
        .filter((item) => item.locker.box_id === box.id)
        .sort((left, right) => left.locker.locker_id - right.locker.locker_id),
      columns: this.config.boxColumns,
    }));

    return {
      boxes: boxOverviews,
      clusters: clusters.map((cluster) => ({
        cluster,
        boxes: boxOverviews.filter((item) => item.box.cluster_id === cluster.id),
      })),
      unplaced: boxOverviews.filter(
        (item) => item.box.cluster_id === null || !clusters.some((cluster) => cluster.id === item.box.cluster_id),
      ),
      components: components.map((component) => ({
        component,
        location:
          overviews.find((item) => item.locker.nfc_flag && item.locker.nfc_id === component.nfc_id) ?? null,
      })),
      calibrations: newestFirst.slice(0, this.config.calibrationsLimit),
      events,
      specifications: this.snapshot.specifications,
      assemblies,
      activeAssembly,
      componentNames: [...new Set(components.map((component) => component.name))].sort((left, right) =>
        left.localeCompare(right, "ru"),
      ),
      boxNames,
      updatedAt: new Date(),
      error: null,
    };
  }

  /** The task of the slot: its cell, or the cell the person has in hands while the slot is empty. */
  private pickOf(assembly: Assembly, locker: Locker): AssemblyPick | null {
    const pick =
      assembly.picks.find((item) => item.box_id === locker.box_id && item.locker_id === locker.locker_id) ?? null;
    return pick !== null && locker.nfc_flag && locker.nfc_id !== pick.nfc_id ? null : pick;
  }

  /** The stand name is added only when there are several stands: with one, the address alone is unambiguous. */
  private boxName(box: Box, clusters: Cluster[]): string {
    if (box.address === null) {
      return box.hardware_id;
    }
    const cluster = clusters.find((item) => item.id === box.cluster_id);
    return clusters.length > 1 && cluster ? `${cluster.name} · ${box.address}` : box.address;
  }
}
