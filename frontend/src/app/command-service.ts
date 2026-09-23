import type { OnboardingSettings } from "../api/box-setup-types";
import type { ApiClient } from "../api/client";
import type { Box, Calibration, CalibrationRequest, ScaleAction, ScaleResult } from "../api/types";
import type { DashboardStore } from "./dashboard-store";

/** Write side of the dashboard: every action refreshes the snapshot so the screen never lags behind. */
export class CommandService {
  constructor(
    private readonly api: ApiClient,
    private readonly store: DashboardStore,
  ) {}

  async claimBox(hardwareId: string): Promise<void> {
    await this.api.claimBox(hardwareId);
  }

  boxes(): Promise<Box[]> {
    return this.api.boxes();
  }

  onboardingSettings(): Promise<OnboardingSettings> {
    return this.api.onboardingSettings();
  }

  async refresh(): Promise<void> {
    await this.store.refreshNow();
  }

  async scale(boxId: string, lockerId: number, action: ScaleAction, grams: number | null = null): Promise<ScaleResult> {
    try {
      return await this.api.scale(boxId, lockerId, action, grams);
    } finally {
      await this.store.refreshNow();
    }
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
