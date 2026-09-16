import type { Box, Calibration, CalibrationRequest, Component, InventoryEvent, Locker } from "./types";

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

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

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  /** Domain errors come back as {"detail": "..."} and are shown to the user as is. */
  private async send<T>(path: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await this.failure(response));
    }
    return (response.status === 204 ? null : await response.json()) as T;
  }

  private async failure(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") {
        return payload.detail;
      }
      if (Array.isArray(payload.detail)) {
        return payload.detail.map((item) => (item as { msg?: string }).msg ?? String(item)).join("; ");
      }
    } catch {
      // Non-JSON error body: the status code is all we have.
    }
    return `HTTP ${response.status}`;
  }
}
