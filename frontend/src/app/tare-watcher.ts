import type { InventoryEvent } from "../api/types";
import type { TareRequest } from "./dashboard-events";
import type { Formatter } from "./formatter";

export type TareOutcome =
  | { kind: "done"; request: TareRequest }
  | { kind: "failed"; request: TareRequest; reason: string }
  | { kind: "timeout"; request: TareRequest };

/**
 * Waits for the box to confirm a zero it was asked to set. The box reports the result over MQTT, the backend logs
 * it as a `tared` / `tare_failed` event, and the dashboard sees that event in the polled log.
 */
export class TareWatcher {
  /** Taring takes ~2 s plus delivery; after this the box is considered silent. */
  private static readonly TIMEOUT_MS = 20_000;
  /** Browser and backend clocks may differ slightly even on one machine. */
  private static readonly CLOCK_SLACK_MS = 3_000;

  private pending: { request: TareRequest; sentAt: number } | null = null;

  constructor(private readonly format: Formatter) {}

  get waiting(): boolean {
    return this.pending !== null;
  }

  start(request: TareRequest, sentAt: number): void {
    this.pending = { request, sentAt };
  }

  cancel(): void {
    this.pending = null;
  }

  /** Returns the outcome once, when it becomes known. */
  check(events: InventoryEvent[], now: number): TareOutcome | null {
    const pending = this.pending;
    if (pending === null) {
      return null;
    }
    const { request, sentAt } = pending;
    const result = events.find(
      (event) =>
        (event.event_type === "tared" || event.event_type === "tare_failed") &&
        event.box_id === request.boxId &&
        event.locker_id === request.lockerId &&
        this.format.date(event.created_at).getTime() >= sentAt - TareWatcher.CLOCK_SLACK_MS,
    );
    if (result) {
      this.pending = null;
      return result.event_type === "tared"
        ? { kind: "done", request }
        : { kind: "failed", request, reason: result.note ?? "бокс отказал" };
    }
    if (now - sentAt > TareWatcher.TIMEOUT_MS) {
      this.pending = null;
      return { kind: "timeout", request };
    }
    return null;
  }
}
