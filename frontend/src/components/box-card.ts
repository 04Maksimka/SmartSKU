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
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 10px;
      }
    `,
  ];

  declare overview: BoxOverview;

  private readonly format = new Formatter();

  protected override render() {
    const { box, lockers } = this.overview;
    const since = box.status_changed_at ? ` с ${this.format.moment(box.status_changed_at)}` : "";
    const unzeroed = lockers.filter((item) => !item.locker.zeroed).length;
    return html`
      <section class="card">
        <header>
          <div>
            <h3>${box.hardware_id}</h3>
            <div class="muted mono">box_id ${box.id}</div>
          </div>
          <div class="actions">
            ${unzeroed
              ? html`<span class="pill warn" title="В этих слотах не установлен ноль: учёт по ним не ведётся">
                  ⚠ без нуля: ${unzeroed}
                </span>`
              : ""}
            <span class="pill ${box.online ? "good" : "bad"}" title="Статус${since}">
              ${box.online ? "● в сети" : "○ не в сети"}
            </span>
          </div>
        </header>
        ${lockers.length
          ? html`<div class="grid">
              ${repeat(
                lockers,
                (item) => item.locker.locker_id,
                (item) => html`<sku-locker-tile .overview=${item}></sku-locker-tile>`,
              )}
            </div>`
          : html`<div class="empty">Бокс ещё не присылал показания слотов</div>`}
      </section>
    `;
  }
}
