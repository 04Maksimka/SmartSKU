import { LitElement, css, html } from "lit";
import { repeat } from "lit/directives/repeat.js";

import { DashboardEvents } from "../app/dashboard-events";
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
  private readonly events = new DashboardEvents();

  protected override render() {
    const { box, lockers } = this.overview;
    const since = box.status_changed_at ? ` с ${this.format.moment(box.status_changed_at)}` : "";
    return html`
      <section class="card">
        <header>
          <div>
            <h3>${box.hardware_id}</h3>
            <div class="muted mono">box_id ${box.id}</div>
          </div>
          <div class="actions">
            ${box.hardware_id.startsWith("emu-") ? "" : html`<button
              ?disabled=${!box.online}
              title="Обнулить вес пустой ячейки в слоте 0"
              @click=${() => this.events.tare(this, { boxId: box.id, lockerId: 0, boxName: box.hardware_id })}
            >Установить ноль</button>`}
            <button
              class="danger"
              title="Удалить бокс из склада вместе с его слотами"
              @click=${() => this.events.deleteBox(this, { boxId: box.id, label: box.hardware_id })}
            >Удалить бокс</button>
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
