import type { ApiClient } from "../api/client";
import type { Calibration, CalibrationRequest } from "../api/types";
import type { DashboardStore } from "./dashboard-store";

/** Write side of the dashboard: every action refreshes the snapshot so the screen never lags behind. */
export class CommandService {
  constructor(
    private readonly api: ApiClient,
    private readonly store: DashboardStore,
  ) {}

  async deleteBox(boxId: string): Promise<void> {
    await this.api.deleteBox(boxId);
    await this.store.refreshNow();
  }

  async deleteLocker(boxId: string, lockerId: number): Promise<void> {
    await this.api.deleteLocker(boxId, lockerId);
    await this.store.refreshNow();
  }

  async tare(boxId: string, lockerId: number): Promise<void> {
    await this.api.tare(boxId, lockerId);
  }

  async startCalibration(request: CalibrationRequest): Promise<Calibration> {
    const calibration = await this.api.startCalibration(request);
    await this.store.refreshNow();
    return calibration;
  }

  async cancelCalibration(calibrationId: number): Promise<void> {
    await this.api.cancelCalibration(calibrationId);
    await this.store.refreshNow();
  }

  async releaseComponent(nfcId: string): Promise<void> {
    await this.api.releaseComponent(nfcId);
    await this.store.refreshNow();
  }
}
