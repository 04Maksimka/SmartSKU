import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Assembly, AssemblyPick } from "../api/types";
import { AssemblyScreen } from "../app/assembly-screen";
import { DashboardEvents } from "../app/dashboard-events";
import type { BoxOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

/** The boxes the assembly takes from, each drawn like the real box with the task on its slot displays. */
interface BoxRoute {
  boxId: string;
  name: string;
  overview: BoxOverview | null;
  picks: AssemblyPick[];
}

/**
 * The running assembly: overall progress and a route through the boxes. Each box is drawn as it stands, seen from the
 * front, with the same "t 20" / "P 3" its displays show; the slots with nothing to do are dark.
 */
export class AssemblyProgress extends LitElement {
  static override properties = {
    assembly: { attribute: false },
    boxes: { attribute: false },
  };

  static override styles = [
    Theme.shared,
    css`
      .card {
        padding: 18px;
        border: 2px solid var(--accent);
        box-shadow: 0 0 0 4px var(--accent-soft), var(--shadow);
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      h2 {
        margin: 0;
        font-size: 20px;
      }

      .sub {
        margin-top: 4px;
        font-size: 13px;
      }

      .progress {
        margin: 16px 0 18px;
      }

      .bar {
        height: 10px;
        border-radius: 999px;
        background: var(--chip);
        overflow: hidden;
      }

      .bar span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--accent);
        transition: width 0.4s ease;
      }

      .progress-label {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
        font-size: 13px;
      }

      .progress-label strong {
        font-family: var(--mono);
      }

      .route {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }

      .box {
        padding: 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--surface-2);
      }

      .box.finished {
        opacity: 0.6;
      }

      .box-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .step {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--accent);
        color: var(--accent-ink, #20242d);
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 700;
      }

      .box.finished .step {
        background: var(--tone-good);
        color: #fff;
      }

      .address {
        font-family: var(--mono);
        font-size: 18px;
        font-weight: 700;
      }

      .alias {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12.5px;
        color: var(--muted);
      }

      .slots {
        display: grid;
        grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
        gap: 6px;
      }

      .slot {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 8px;
        border-radius: 8px;
        border: 1px dashed var(--border);
        background: transparent;
      }

      .slot.take {
        border: 2px solid var(--accent);
        background: var(--surface);
      }

      .slot.put {
        border: 2px solid var(--tone-bad);
        background: var(--surface);
      }

      .slot.done {
        border: 1px solid var(--tone-good);
        background: var(--tone-good-bg);
      }

      .slot-label {
        font-family: var(--mono);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .panel {
        border-radius: 6px;
        background: var(--panel, #0c0d10);
        padding: 7px 6px;
      }

      .panel sku-segment-display {
        height: 26px;
        margin: 0 auto;
        aspect-ratio: 278 / 104;
      }

      .component {
        font-size: 12.5px;
        font-weight: 600;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .task-note {
        font-size: 12px;
        color: var(--muted);
      }

      .slot.put .task-note {
        color: var(--tone-bad);
        font-weight: 600;
      }

      .slot.done .task-note {
        color: var(--tone-good);
        font-weight: 600;
      }

      .warn {
        margin-top: 8px;
        font-size: 12px;
        color: var(--tone-warn);
      }
    `,
  ];

  declare assembly: Assembly;
  declare boxes: BoxOverview[];

  private readonly format = new Formatter();
  private readonly screen = new AssemblyScreen();
  private readonly events = new DashboardEvents();

  constructor() {
    super();
    this.boxes = [];
  }

  protected override render() {
    const assembly = this.assembly;
    const done = assembly.picks.filter((pick) => pick.remaining === 0).length;
    const required = assembly.picks.reduce((sum, pick) => sum + pick.quantity, 0);
    const taken = assembly.picks.reduce((sum, pick) => sum + Math.min(pick.taken, pick.quantity), 0);
    const routes = this.routes();
    return html`<section class="card">
      <header>
        <div>
          <h2>Сборка «${this.format.assemblyTitle(assembly.name, assembly.kits)}»</h2>
          <div class="sub muted">
            №${assembly.id} · начата ${this.format.moment(assembly.started_at)} · ${routes.length}
            ${this.boxesWord(routes.length)}. Дисплеи показывают: <b>t N</b> — взять N, <b>P M</b> — положить M
            обратно. Взяли нужное — дисплей гаснет.
          </div>
        </div>
        <button class="danger" @click=${() => this.events.cancelAssembly(this, assembly)}>Прервать сборку</button>
      </header>
      <div class="progress">
        <div class="progress-label">
          <span>Ячеек готово: <strong>${done} / ${assembly.picks.length}</strong></span>
          <span class="muted">взято <strong>${taken} / ${required}</strong> шт</span>
        </div>
        <div class="bar"><span style="width: ${required ? (taken / required) * 100 : 0}%"></span></div>
      </div>
      <div class="route">
        ${repeat(
          routes,
          (route) => route.boxId,
          (route, index) => this.renderBox(route, index + 1),
        )}
      </div>
    </section>`;
  }

  private renderBox(route: BoxRoute, step: number) {
    const finished = route.picks.every((pick) => pick.remaining === 0);
    const columns = route.overview?.columns ?? 2;
    const lockerCount = Math.max(columns * 2, (route.overview?.lockers.length ?? 0), ...route.picks.map((p) => p.locker_id + 1));
    const alias = route.overview?.box.alias;
    return html`<div class="box ${finished ? "finished" : ""}">
      <div class="box-head">
        <span class="step">${finished ? "✓" : step}</span>
        <span class="address">${route.name}</span>
        <span class="alias">${alias ?? ""}</span>
      </div>
      <div class="slots" style="--columns: ${columns}">
        ${Array.from({ length: lockerCount }, (_, lockerId) =>
          this.renderSlot(route.picks.find((pick) => pick.locker_id === lockerId) ?? null, lockerId),
        )}
      </div>
      ${route.overview && !route.overview.box.online
        ? html`<div class="warn">Бокс не в сети: дисплеи не обновятся, пока он не вернётся</div>`
        : nothing}
    </div>`;
  }

  private renderSlot(pick: AssemblyPick | null, lockerId: number) {
    const label = html`<span class="slot-label">Слот ${this.format.slot(lockerId)}</span>`;
    if (pick === null) {
      return html`<div class="slot">${label}</div>`;
    }
    const state = this.screen.state(pick);
    return html`<div class="slot ${state}">
      ${label}
      <div class="panel"><sku-segment-display .text=${this.screen.text(pick)}></sku-segment-display></div>
      <span class="component">${pick.component_name}</span>
      <span class="task-note">
        ${state === "done" ? `✓ взято ${pick.quantity}` : this.screen.hint(pick)}
        ${state !== "done" ? html`<br />взято ${Math.max(pick.taken, 0)} из ${pick.quantity}` : nothing}
        ${pick.inserted ? nothing : html`<br />ячейка вынута`}
      </span>
    </div>`;
  }

  /** Boxes in the order of their addresses, so the route goes along the stand. */
  private routes(): BoxRoute[] {
    const routes = new Map<string, BoxRoute>();
    for (const pick of this.assembly.picks) {
      let route = routes.get(pick.box_id);
      if (route === undefined) {
        const overview = this.boxes.find((item) => item.box.id === pick.box_id) ?? null;
        route = { boxId: pick.box_id, name: overview?.name ?? pick.box_id, overview, picks: [] };
        routes.set(pick.box_id, route);
      }
      route.picks.push(pick);
    }
    return [...routes.values()].sort((left, right) => left.name.localeCompare(right.name, "ru", { numeric: true }));
  }

  private boxesWord(count: number): string {
    const tens = count % 100;
    const ones = count % 10;
    if (tens >= 11 && tens <= 14) {
      return "боксов";
    }
    return ones === 1 ? "бокс" : ones >= 2 && ones <= 4 ? "бокса" : "боксов";
  }
}
