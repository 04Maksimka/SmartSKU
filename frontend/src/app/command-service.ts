import type { OnboardingSettings } from "../api/box-setup-types";
import type { ApiClient } from "../api/client";
import type {
  Assembly,
  Availability,
  Box,
  Calibration,
  Locate,
  CalibrationRequest,
  ScaleAction,
  ScaleResult,
  SpecificationRequest,
} from "../api/types";
import type { DashboardStore } from "./dashboard-store";

/**
 * Write side of the dashboard: every action refreshes the snapshot so the screen never lags behind. With the view-only
 * guest link nothing is written (Caddy rejects it anyway), only a component search is allowed.
 */
export class CommandService {
  static readonly READ_ONLY_MESSAGE = "Режим только просмотра: это действие недоступно";

  constructor(
    private readonly api: ApiClient,
    private readonly store: DashboardStore,
    readonly readOnly = false,
  ) {}

  private writable(): void {
    if (this.readOnly) {
      throw new Error(CommandService.READ_ONLY_MESSAGE);
    }
  }

  async claimBox(hardwareId: string): Promise<void> {
    this.writable();
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
    this.writable();
    try {
      return await this.api.scale(boxId, lockerId, action, grams);
    } finally {
      await this.store.refreshNow();
    }
  }

  async startCalibration(request: CalibrationRequest): Promise<Calibration> {
    this.writable();
    const calibration = await this.api.startCalibration(request);
    await this.store.refreshNow();
    return calibration;
  }

  async cancelCalibration(calibrationId: number): Promise<void> {
    this.writable();
    await this.api.cancelCalibration(calibrationId);
    await this.store.refreshNow();
  }

  async placeBox(boxId: string, clusterId: number | null, x = 0, y = 0): Promise<void> {
    this.writable();
    await this.api.placeBox(boxId, clusterId, x, y);
    await this.store.refreshNow();
  }

  async unplaceBox(boxId: string): Promise<void> {
    this.writable();
    await this.api.unplaceBox(boxId);
    await this.store.refreshNow();
  }

  async renameBox(boxId: string, alias: string | null): Promise<void> {
    this.writable();
    await this.api.renameBox(boxId, alias);
    await this.store.refreshNow();
  }

  async renameCluster(clusterId: number, name: string): Promise<void> {
    this.writable();
    await this.api.renameCluster(clusterId, name);
    await this.store.refreshNow();
  }

  async releaseComponent(nfcId: string): Promise<void> {
    this.writable();
    await this.api.releaseComponent(nfcId);
    await this.store.refreshNow();
  }

  async setLowStock(nfcId: string, lowStock: number | null): Promise<void> {
    this.writable();
    await this.api.setLowStock(nfcId, lowStock);
    await this.store.refreshNow();
  }

  /** Saves a new specification, or changes the one with this id. */
  async saveSpecification(specificationId: number | null, request: SpecificationRequest): Promise<void> {
    this.writable();
    if (specificationId === null) {
      await this.api.createSpecification(request);
    } else {
      await this.api.updateSpecification(specificationId, request);
    }
    await this.store.refreshNow();
  }

  async deleteSpecification(specificationId: number): Promise<void> {
    this.writable();
    await this.api.deleteSpecification(specificationId);
    await this.store.refreshNow();
  }

  availability(specificationId: number, kits: number): Promise<Availability> {
    return this.api.availability(specificationId, kits);
  }

  async startAssembly(specificationId: number, kits: number): Promise<Assembly> {
    this.writable();
    const assembly = await this.api.startAssembly(specificationId, kits);
    await this.store.refreshNow();
    return assembly;
  }

  async startLocate(componentName: string): Promise<Locate> {
    const locate = await this.api.startLocate(componentName);
    await this.store.refreshNow();
    return locate;
  }

  async stopLocate(): Promise<void> {
    await this.api.stopLocate();
    await this.store.refreshNow();
  }

  async cancelAssembly(assemblyId: number): Promise<void> {
    this.writable();
    await this.api.cancelAssembly(assemblyId);
    await this.store.refreshNow();
  }
}
