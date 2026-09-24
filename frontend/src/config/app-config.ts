import { load } from "js-yaml";

export interface AppConfig {
  apiBaseUrl: string;
  refreshIntervalMs: number;
  eventsLimit: number;
  calibrationsLimit: number;
  assembliesLimit: number;
  /** Slots per row on a box card, matching the physical box. */
  boxColumns: number;
  /** Weight of the reference used in the load cell setup, grams. */
  referenceGrams: number;
}

export class ConfigLoader {
  async load(url: string): Promise<AppConfig> {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Config ${url}: HTTP ${response.status}`);
    }
    const raw = (load(await response.text()) ?? {}) as Record<string, unknown>;
    return {
      apiBaseUrl: this.string(raw, "api_base_url", ""),
      refreshIntervalMs: this.positive(raw, "refresh_interval_ms", 1000),
      eventsLimit: this.positive(raw, "events_limit", 200),
      calibrationsLimit: this.positive(raw, "calibrations_limit", 20),
      assembliesLimit: this.positive(raw, "assemblies_limit", 20),
      boxColumns: this.positive(raw, "box_columns", 2),
      referenceGrams: this.positive(raw, "reference_grams", 100),
    };
  }

  private string(raw: Record<string, unknown>, key: string, fallback: string): string {
    const value = raw[key];
    return typeof value === "string" ? value.replace(/\/$/, "") : fallback;
  }

  private positive(raw: Record<string, unknown>, key: string, fallback: number): number {
    const value = raw[key];
    return typeof value === "number" && value > 0 ? value : fallback;
  }
}
