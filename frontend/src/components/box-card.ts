import { LitElement, css, html } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { BoxOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

export class BoxCard extends LitElement {
  static override properties = { overview: { attribute: false } };

  static override styles = [
    Theme.shared,
    css`
      .card {
        padding: 16px;
      }

      header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 14px;
      }

      h3 {
        margin: 0;
        font-size: 17px;
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
    `,
  ];

  declare overview: BoxOverview;

  private readonly format = new Formatter();

  protected override render() {
    const { box, lockers } = this.overview;
    const since = box.status_changed_at ? ` с ${this.format.moment(box.status_changed_at)}` : "";
    const unready = lockers.filter(
      ({ locker }) => !locker.slot_ready || (locker.nfc_flag && (!locker.cell_tared || locker.tag_error)),
    ).length;
    return html`
      <section class="card">
        <header>
          <div>
            <h3>${box.hardware_id}</h3>
            <div class="muted mono">box_id ${box.id}</div>
          </div>
          <div class="actions">
            ${unready
              ? html`<span class="pill warn" title="Слот не настроен или ячейка не взвешена пустой: учёт по ним не ведётся">
                  ⚠ не настроено: ${unready}
                </span>`
              : ""}
            <span class="pill ${box.online ? "good" : "bad"}" title="Статус${since}">
              ${box.online ? "● в сети" : "○ не в сети"}
            </span>
          </div>
        </header>
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
      </section>
    `;
  }

  /** Fixed cell of the grid, so a slot that has not reported yet leaves a gap instead of shifting the others. */
  private placement(lockerId: number): string {
    const columns = this.overview.columns;
    return `grid-row: ${Math.floor(lockerId / columns) + 1}; grid-column: ${(lockerId % columns) + 1}`;
  }
}
