import type { Calibration } from "../api/types";
import type { LockerOverview } from "./dashboard-store";

export interface CancelCalibrationRequest {
  id: number;
  label: string;
}

export interface ReleaseComponentRequest {
  nfcId: string;
  label: string;
}

/** Actions travel from the tiles and tables up to sku-app, which owns the CommandService and the dialogs. */
export class DashboardEvents {
  static readonly CALIBRATE = "sku-calibrate";
  static readonly SHOW_CALIBRATION = "sku-show-calibration";
  static readonly SCALE_SETUP = "sku-scale-setup";
  static readonly CANCEL_CALIBRATION = "sku-cancel-calibration";
  static readonly RELEASE_COMPONENT = "sku-release-component";

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

  private dispatch(target: EventTarget, type: string, detail: unknown): void {
    target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}
