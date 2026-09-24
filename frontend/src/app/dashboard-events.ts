import type { Assembly, Calibration, Cluster } from "../api/types";
import type { LockerOverview } from "./dashboard-store";

export interface CancelCalibrationRequest {
  id: number;
  label: string;
}

export interface ReleaseComponentRequest {
  nfcId: string;
  label: string;
}

/** A grid cell of a stand chosen for the box being placed; no stand starts a new one. */
export interface PlaceAtRequest {
  clusterId: number | null;
  x: number;
  y: number;
}

/** Actions travel from the tiles and tables up to sku-app, which owns the CommandService and the dialogs. */
export class DashboardEvents {
  static readonly CALIBRATE = "sku-calibrate";
  static readonly SHOW_CALIBRATION = "sku-show-calibration";
  static readonly SCALE_SETUP = "sku-scale-setup";
  static readonly CANCEL_CALIBRATION = "sku-cancel-calibration";
  static readonly RELEASE_COMPONENT = "sku-release-component";
  static readonly SELECT_BOX = "sku-select-box";
  static readonly PLACE_BOX = "sku-place-box";
  static readonly PLACE_AT = "sku-place-at";
  static readonly RENAME_CLUSTER = "sku-rename-cluster";
  static readonly CANCEL_ASSEMBLY = "sku-cancel-assembly";
  static readonly LOCATE = "sku-locate";

  calibrate(target: EventTarget, locker: LockerOverview | null): void {
    this.dispatch(target, DashboardEvents.CALIBRATE, locker);
  }

  /** Reopens the checklist of a running calibration. */
  showCalibration(target: EventTarget, calibration: Calibration): void {
    this.dispatch(target, DashboardEvents.SHOW_CALIBRATION, calibration);
  }

  /** Opens the load cell setup for this locker only, starting with what it lacks. */
  scaleSetup(target: EventTarget, locker: LockerOverview): void {
    this.dispatch(target, DashboardEvents.SCALE_SETUP, locker);
  }

  cancelCalibration(target: EventTarget, request: CancelCalibrationRequest): void {
    this.dispatch(target, DashboardEvents.CANCEL_CALIBRATION, request);
  }

  releaseComponent(target: EventTarget, request: ReleaseComponentRequest): void {
    this.dispatch(target, DashboardEvents.RELEASE_COMPONENT, request);
  }

  /** Opens the full card of a box tapped on the stand map. */
  selectBox(target: EventTarget, boxId: string): void {
    this.dispatch(target, DashboardEvents.SELECT_BOX, boxId);
  }

  /** Starts choosing a place on a stand for the box (a new one or one being moved). */
  placeBox(target: EventTarget, boxId: string): void {
    this.dispatch(target, DashboardEvents.PLACE_BOX, boxId);
  }

  placeAt(target: EventTarget, request: PlaceAtRequest): void {
    this.dispatch(target, DashboardEvents.PLACE_AT, request);
  }

  renameCluster(target: EventTarget, cluster: Cluster): void {
    this.dispatch(target, DashboardEvents.RENAME_CLUSTER, cluster);
  }

  /** Stops the running assembly: the displays go back to counting. */
  cancelAssembly(target: EventTarget, assembly: Assembly): void {
    this.dispatch(target, DashboardEvents.CANCEL_ASSEMBLY, assembly);
  }

  /** Finds a component on the stands: its cells light up and their displays blink. */
  locate(target: EventTarget, componentName: string): void {
    this.dispatch(target, DashboardEvents.LOCATE, componentName);
  }

  private dispatch(target: EventTarget, type: string, detail: unknown): void {
    target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}
