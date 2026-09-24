import { LitElement, css, html } from "lit";
import { repeat } from "lit/directives/repeat.js";

import { DashboardEvents } from "../app/dashboard-events";
import type { BoxOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

export class BoxCard extends LitElement {
  static override properties = {
    overview: { attribute: false },
    editing: { type: Boolean },
    moving: { type: Boolean },
  };

  static override styles = [
    Theme.shared,
    css`
      .card {
        padding: 16px;
        height: 100%;
      }

      .card.moving {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
      }

      .title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
      }

      .address {
        font-family: var(--mono);
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.02em;
        line-height: 1.1;
      }

      .alias {
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .layout-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 12px;
      }

      .layout-actions button {
        padding: 5px 10px;
        font-size: 12.5px;
      }

      header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-bottom: 14px;
      }

      h3 {
        margin: 0;
        font-family: var(--mono);
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }

      .hw-id {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--muted);
        letter-spacing: 0.02em;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
        gap: 10px;
      }

      .offline-note {
        margin: -4px 0 12px;
        padding: 8px 10px;
        border-radius: var(--r-xs, 6px);
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
        font-size: 12.5px;
      }

      @media (max-width: 720px) {
        .card {
          padding: 12px;
        }

        .grid {
          gap: 8px;
        }
      }
    `,
  ];

  declare overview: BoxOverview;
  /** The stand is being rearranged: the card offers to move, rename or take the box off the stand. */
  declare editing: boolean;
  /** This box is the one being placed right now. */
  declare moving: boolean;

  private readonly format = new Formatter();
  private readonly events = new DashboardEvents();

  constructor() {
    super();
    this.editing = false;
    this.moving = false;
  }

  protected override render() {
    const { box, lockers } = this.overview;
    const since = box.status_changed_at ? ` с ${this.format.moment(box.status_changed_at)}` : "";
    const unready = lockers.filter(
      ({ locker }) => !locker.slot_ready || (locker.nfc_flag && (!locker.cell_tared || locker.tag_error)),
    ).length;
    return html`
      <section class="card ${this.moving ? "moving" : ""}">
        <header>
          <div>
            ${box.address
              ? html`<div class="title">
                  <span class="address" title="Столбец и ряд на стенде">${box.address}</span>
                  ${box.alias ? html`<span class="alias">${box.alias}</span>` : ""}
                </div>`
              : html`<div class="title">
                  <h3>${box.hardware_id}</h3>
                  ${box.alias ? html`<span class="alias">${box.alias}</span>` : ""}
                </div>`}
            <div class="hw-id" title="Аппаратный id бокса">${box.address ? box.hardware_id : "не размещён на стенде"}</div>
          </div>
          <div class="actions">
            ${unready
              ? html`<span class="pill warn" title="Слот не настроен или ячейка не взвешена пустой: учёт по ним не ведётся">
                  ⚠ внимание: ${unready}
                </span>`
              : ""}
            <span class="pill ${box.online ? "good" : "bad"}" title="Статус${since}">
              ${box.online ? "● в сети" : "○ не в сети"}
            </span>
          </div>
        </header>
        ${box.online
          ? ""
          : html`<div class="offline-note">
              Нет связи с боксом${since}: показаны последние полученные данные.
            </div>`}
        ${lockers.length
          ? html`<div class="grid" style="--columns: ${this.overview.columns}">
              ${repeat(
                lockers,
                (item) => item.locker.locker_id,
                (item) =>
                  html`<sku-locker-tile
                    .overview=${item}
                    style=${this.placement(item.locker.locker_id)}
                  ></sku-locker-tile>`,
              )}
            </div>`
          : html`<div class="empty">Бокс ещё не присылал показания слотов</div>`}
        ${this.renderLayoutActions()}
      </section>
    `;
  }

  private renderLayoutActions() {
    const item = this.overview;
    const placed = item.box.address !== null;
    if (placed && !this.editing) {
      return "";
    }
    return html`<div class="layout-actions">
      <button class=${placed ? "" : "primary"} ?disabled=${this.moving} @click=${() => this.events.placeBox(this, item.box.id)}>
        ${placed ? "Переместить" : "Указать место на стенде"}
      </button>
      <button @click=${() => this.events.renameBox(this, item)}>${item.box.alias ? "Изменить название" : "Дать название"}</button>
      ${placed
        ? html`<button class="danger" @click=${() => this.events.unplaceBox(this, item)}>Убрать со стенда</button>`
        : ""}
    </div>`;
  }

  /** Fixed cell of the grid, so a slot that has not reported yet leaves a gap instead of shifting the others. */
  private placement(lockerId: number): string {
    const columns = this.overview.columns;
    return `grid-row: ${Math.floor(lockerId / columns) + 1}; grid-column: ${(lockerId % columns) + 1}`;
  }
}
