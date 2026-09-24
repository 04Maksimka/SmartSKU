import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import { DashboardEvents } from "../app/dashboard-events";
import type { BoxOverview, ClusterOverview } from "../app/dashboard-store";
import { Theme } from "./theme";

/** A free grid cell next to a box of the stand, where the box being placed can go. */
interface Candidate {
  x: number;
  y: number;
  /** Where it is relative to a box already there, e.g. "справа от A1". */
  hint: string;
}

/**
 * The stand as it stands, seen from the front: every box in its grid cell, rows counted bottom up. While a box is
 * being placed, the free cells next to the other boxes turn into "put it here" buttons.
 */
export class StandView extends LitElement {
  private static readonly SIDES: { dx: number; dy: number; hint: string }[] = [
    { dx: 1, dy: 0, hint: "справа от" },
    { dx: -1, dy: 0, hint: "слева от" },
    { dx: 0, dy: 1, hint: "над" },
    { dx: 0, dy: -1, hint: "под" },
  ];

  static override properties = {
    overview: { attribute: false },
    editing: { type: Boolean },
    placing: { attribute: false },
  };

  static override styles = [
    Theme.shared,
    css`
      .scroller {
        overflow-x: auto;
        padding: 2px;
        margin: -2px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(var(--columns), minmax(min(320px, calc(100vw - 40px)), 460px));
        gap: 12px;
      }

      .candidate {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-height: 180px;
        border: 2px dashed var(--accent);
        border-radius: var(--r, 14px);
        background: var(--accent-soft);
        color: var(--text);
        font-size: 15px;
      }

      .candidate small {
        color: var(--muted);
        font-weight: 500;
        font-size: 12.5px;
      }

      .candidate:hover:not(:disabled) {
        color: var(--text);
        filter: brightness(1.04);
      }
    `,
  ];

  declare overview: ClusterOverview;
  declare editing: boolean;
  /** Box being placed on a stand right now, or null. */
  declare placing: BoxOverview | null;

  private readonly events = new DashboardEvents();

  constructor() {
    super();
    this.editing = false;
    this.placing = null;
  }

  protected override render() {
    const { cluster, boxes } = this.overview;
    const candidates = this.candidates();
    const cells = [
      ...boxes.map((item) => ({ x: item.box.grid_x ?? 0, y: item.box.grid_y ?? 0 })),
      ...candidates,
    ];
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const maxY = Math.max(...cells.map((cell) => cell.y));
    const place = (x: number, y: number) => `grid-column: ${x - minX + 1}; grid-row: ${maxY - y + 1}`;
    return html`
      <div class="section-title">
        <h2>${cluster.name}<span class="count">${boxes.length}</span></h2>
        ${this.editing
          ? html`<button @click=${() => this.events.renameCluster(this, cluster)}>Переименовать стенд</button>`
          : nothing}
      </div>
      <div class="scroller">
        <div class="grid" style="--columns: ${maxX - minX + 1}">
          ${repeat(
            boxes,
            (item) => item.box.id,
            (item) => html`<sku-box-card
              .overview=${item}
              ?editing=${this.editing}
              ?moving=${this.placing?.box.id === item.box.id}
              style=${place(item.box.grid_x ?? 0, item.box.grid_y ?? 0)}
            ></sku-box-card>`,
          )}
          ${candidates.map(
            (candidate) => html`<button
              class="candidate"
              style=${place(candidate.x, candidate.y)}
              @click=${() => this.events.placeAt(this, { clusterId: cluster.id, x: candidate.x, y: candidate.y })}
            >
              + Поставить сюда
              <small>${candidate.hint}</small>
            </button>`,
          )}
        </div>
      </div>
    `;
  }

  /** Boxes of a stand are joined side by side, so the new place must touch another box of the stand. */
  private candidates(): Candidate[] {
    const placing = this.placing;
    if (placing === null) {
      return [];
    }
    const others = this.overview.boxes.filter((item) => item.box.id !== placing.box.id);
    const taken = new Set(this.overview.boxes.map((item) => `${item.box.grid_x},${item.box.grid_y}`));
    const found = new Map<string, Candidate>();
    for (const item of others) {
      for (const side of StandView.SIDES) {
        const x = (item.box.grid_x ?? 0) + side.dx;
        const y = (item.box.grid_y ?? 0) + side.dy;
        const key = `${x},${y}`;
        if (!taken.has(key) && !found.has(key)) {
          found.set(key, { x, y, hint: `${side.hint} ${item.box.address}` });
        }
      }
    }
    return [...found.values()];
  }
}
