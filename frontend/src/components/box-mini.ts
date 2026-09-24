import { LitElement, css, html, nothing } from "lit";

import { DashboardEvents } from "../app/dashboard-events";
import type { BoxOverview, LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

type SlotTone = "counted" | "idle" | "out" | "busy" | "warn";

/**
 * A box on the stand map: its address and the four slots with their counts, small enough to see a whole stand at
 * once. Tapping it opens the full card below the map.
 */
export class BoxMini extends LitElement {
  static override properties = {
    overview: { attribute: false },
    selected: { type: Boolean },
    moving: { type: Boolean },
  };

  static override styles = [
    Theme.shared,
    css`
      :host {
        height: 100%;
      }

      button.box {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        height: 100%;
        padding: 10px;
        text-align: left;
        font-weight: 400;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r-sm, 9px);
        box-shadow: var(--shadow);
      }

      button.box:hover:not(:disabled) {
        color: var(--text);
      }

      button.box.selected {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
      }

      button.box.moving {
        border-style: dashed;
        border-color: var(--accent);
      }

      .head {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .address {
        font-family: var(--mono);
        font-size: 17px;
        font-weight: 700;
      }

      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--muted);
      }

      .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--tone-good);
      }

      .dot.off {
        background: var(--tone-bad);
      }

      .slots {
        display: grid;
        grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
        gap: 4px;
      }

      .slot {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        min-height: 42px;
        padding: 4px 6px;
        border-radius: 6px;
        background: var(--chip);
      }

      .count {
        font-family: var(--mono);
        font-size: 15px;
        font-weight: 700;
        line-height: 1.1;
      }

      .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10.5px;
        color: var(--muted);
      }

      .slot.idle .count,
      .slot.out .count {
        color: var(--muted);
      }

      .slot.out {
        background: transparent;
        border: 1px dashed var(--border);
      }

      .slot.busy {
        background: var(--tone-info-bg);
      }

      .slot.busy .count {
        color: var(--tone-info);
      }

      .slot.warn {
        background: var(--tone-warn-bg);
      }

      .slot.warn .count {
        color: var(--tone-warn);
      }
    `,
  ];

  declare overview: BoxOverview;
  declare selected: boolean;
  declare moving: boolean;

  private readonly format = new Formatter();
  private readonly events = new DashboardEvents();

  constructor() {
    super();
    this.selected = false;
    this.moving = false;
  }

  protected override render() {
    const { box, lockers, columns } = this.overview;
    const title = box.alias ?? (box.address ? box.hardware_id : "не размещён");
    return html`<button
      class="box ${this.selected ? "selected" : ""} ${this.moving ? "moving" : ""}"
      aria-pressed=${this.selected ? "true" : "false"}
      @click=${() => this.events.selectBox(this, box.id)}
    >
      <span class="head">
        <span class="address">${box.address ?? box.hardware_id.slice(0, 4)}</span>
        <span class="name">${title}</span>
        <span class="dot ${box.online ? "" : "off"}" title=${box.online ? "В сети" : "Не в сети"}></span>
      </span>
      <span class="slots" style="--columns: ${columns}">
        ${Array.from({ length: Math.max(lockers.length, columns * 2) }, (_, lockerId) =>
          this.renderSlot(lockers.find((item) => item.locker.locker_id === lockerId) ?? null, lockerId),
        )}
      </span>
    </button>`;
  }

  private renderSlot(item: LockerOverview | null, lockerId: number) {
    const [tone, count, label] = item ? this.describe(item) : (["out", "·", "нет данных"] as const);
    const slot = this.format.slot(lockerId);
    return html`<span class="slot ${tone}" title="Слот ${slot}: ${label}">
      <span class="count">${count}</span>
      ${label ? html`<span class="label">${label}</span>` : nothing}
    </span>`;
  }

  /** What a person at the rack cares about: how many pieces and of what, or why there is no count. */
  private describe({ locker, pendingCalibration }: LockerOverview): [SlotTone, string, string] {
    if (locker.calibration || pendingCalibration) {
      return ["busy", "…", "калибровка"];
    }
    if (!locker.nfc_flag) {
      return ["out", "—", "ячейка вынута"];
    }
    if (locker.tag_error || !locker.slot_ready || !locker.cell_tared) {
      return ["warn", "!", locker.tag_error ? "метка не читается" : "не настроен"];
    }
    if (locker.component === null) {
      return ["idle", "—", "свободна"];
    }
    return ["counted", String(locker.quantity ?? "—"), locker.component.name];
  }
}
