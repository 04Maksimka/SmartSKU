import { HttpClient } from "./http-client";
import type { Box, Calibration, CalibrationRequest, Component, InventoryEvent, Locker } from "./types";

export class ApiClient extends HttpClient {
  boxes(): Promise<Box[]> {
    return this.get("/api/boxes");
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
