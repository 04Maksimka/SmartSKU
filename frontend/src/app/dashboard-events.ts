import type { LockerOverview } from "./dashboard-store";

export interface DeleteBoxRequest {
  boxId: string;
  label: string;
}

export interface DeleteLockerRequest {
  boxId: string;
  lockerId: number;
  label: string;
}

export interface TareRequest {
  boxId: string;
  lockerId: number;
  boxName: string;
}

export interface CancelCalibrationRequest {
  id: number;
  label: string;
}

export interface ReleaseComponentRequest {
  nfcId: string;
  label: string;
}

/** Actions travel from the tiles and tables up to sku-app, which owns the CommandService. */
export class DashboardEvents {
  static readonly CALIBRATE = "sku-calibrate";
  static readonly TARE = "sku-tare";
  static readonly DELETE_BOX = "sku-delete-box";
  static readonly DELETE_LOCKER = "sku-delete-locker";
  static readonly CANCEL_CALIBRATION = "sku-cancel-calibration";
  static readonly RELEASE_COMPONENT = "sku-release-component";

  calibrate(target: EventTarget, locker: LockerOverview | null): void {
    this.dispatch(target, DashboardEvents.CALIBRATE, locker);
  }

  deleteBox(target: EventTarget, request: DeleteBoxRequest): void {
    this.dispatch(target, DashboardEvents.DELETE_BOX, request);
  }

  deleteLocker(target: EventTarget, request: DeleteLockerRequest): void {
    this.dispatch(target, DashboardEvents.DELETE_LOCKER, request);
  }

  tare(target: EventTarget, request: TareRequest): void {
    this.dispatch(target, DashboardEvents.TARE, request);
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
