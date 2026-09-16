import type { Box, Calibration, Component, InventoryEvent, Locker } from "./types";

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

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
