import type { Box } from "../api/types";

/**
 * A cloud box turns Bluetooth off before it connects over TLS (both do not fit in its memory), so the setup dialog
 * learns that the box arrived from the backend: the box is online and its status changed since the handover.
 * Server timestamps are compared with each other only, so the browser clock does not matter.
 */
export class BoxArrivalWatch {
  private static readonly INTERVAL_MS = 2000;

  private timer: number | null = null;

  constructor(private readonly loadBoxes: () => Promise<Box[]>) {}

  async start(hardwareId: string, onArrived: (box: Box) => void): Promise<void> {
    this.stop();
    const baseline = await this.find(hardwareId);
    const since = baseline?.status_changed_at ?? null;
    this.timer = window.setInterval(() => {
      void this.find(hardwareId).then((box) => {
        if (this.timer !== null && box?.online && (box.status_changed_at !== since || baseline === undefined)) {
          this.stop();
          onArrived(box);
        }
      });
    }, BoxArrivalWatch.INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async find(hardwareId: string): Promise<Box | undefined> {
    try {
      return (await this.loadBoxes()).find((box) => box.hardware_id === hardwareId);
    } catch {
      return undefined;
    }
  }
}
