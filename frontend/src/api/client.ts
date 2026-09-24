import type { OnboardingSettings } from "./box-setup-types";
import { HttpClient } from "./http-client";
import type {
  Box,
  Calibration,
  CalibrationRequest,
  Cluster,
  Component,
  InventoryEvent,
  Locker,
  ScaleAction,
  ScaleResult,
} from "./types";

export class ApiClient extends HttpClient {
  boxes(): Promise<Box[]> {
    return this.get("/api/boxes");
  }

  clusters(): Promise<Cluster[]> {
    return this.get("/api/clusters");
  }

  renameCluster(clusterId: number, name: string): Promise<Cluster> {
    return this.send(`/api/clusters/${clusterId}`, "PATCH", { name });
  }

  renameBox(boxId: string, alias: string | null): Promise<Box> {
    return this.send(`/api/boxes/${encodeURIComponent(boxId)}`, "PATCH", { alias });
  }

  /** Puts the box next to another box of the stand; no stand starts a new one. The stand is renumbered from A1. */
  placeBox(boxId: string, clusterId: number | null, x: number, y: number): Promise<Box> {
    return this.send(`/api/boxes/${encodeURIComponent(boxId)}/placement`, "PUT", { cluster_id: clusterId, x, y });
  }

  unplaceBox(boxId: string): Promise<Box> {
    return this.send(`/api/boxes/${encodeURIComponent(boxId)}/placement`, "DELETE");
  }

  lockers(): Promise<Locker[]> {
    return this.get("/api/lockers");
  }

  components(): Promise<Component[]> {
    return this.get("/api/components");
  }

  calibrations(): Promise<Calibration[]> {
    return this.get("/api/calibrations");
  }

  events(limit: number): Promise<InventoryEvent[]> {
    return this.get(`/api/events?limit=${limit}`);
  }

  /** A new box registers only after it was claimed here, see backend ProvisioningService. */
  claimBox(hardwareId: string): Promise<void> {
    return this.send("/api/onboarding/claims", "POST", { hardware_id: hardwareId });
  }

  onboardingSettings(): Promise<OnboardingSettings> {
    return this.get("/api/onboarding/settings");
  }

  /** Waits while the box measures (a few seconds); a box failure comes as an error with the reason. */
  scale(boxId: string, lockerId: number, action: ScaleAction, grams: number | null): Promise<ScaleResult> {
    return this.send(`/api/boxes/${encodeURIComponent(boxId)}/lockers/${lockerId}/scale`, "POST", { action, grams });
  }

  startCalibration(request: CalibrationRequest): Promise<Calibration> {
    return this.send("/api/calibrations", "POST", request);
  }

  cancelCalibration(calibrationId: number): Promise<Calibration> {
    return this.send(`/api/calibrations/${calibrationId}`, "DELETE");
  }

  releaseComponent(nfcId: string): Promise<void> {
    return this.send(`/api/components/${encodeURIComponent(nfcId)}`, "DELETE");
  }
}
