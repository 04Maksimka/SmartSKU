import { LitElement, html } from "lit";

import { DashboardEvents } from "../app/dashboard-events";
import type { ComponentOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

/** All calibrated cells with their contents, including cells that are currently pulled out. */
export class ComponentTable extends LitElement {
  static override properties = {
    items: { attribute: false },
    query: { state: true },
  };

  static override styles = [Theme.shared];

  declare items: ComponentOverview[];
  declare query: string;

  private readonly format = new Formatter();
  private readonly events = new DashboardEvents();

  constructor() {
    super();
    this.items = [];
    this.query = "";
  }

  protected override render() {
    const visible = this.filtered();
    return html`
      <div class="section-title">
        <h2>Компоненты <span class="muted">${this.items.length}</span></h2>
        <input
          type="search"
          placeholder="Название, тег или ячейка"
          .value=${this.query}
          @input=${(event: Event) => (this.query = (event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="card table-wrap">
        ${visible.length
          ? html`<table>
              <thead>
                <tr>
                  <th>Компонент</th>
                  <th class="num">Количество</th>
                  <th class="num">1 штука</th>
                  <th>Где</th>
                  <th>Ячейка</th>
                  <th>Калибровка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${visible.map((item) => this.renderRow(item))}
              </tbody>
            </table>`
          : html`<div class="empty">
              ${this.items.length ? "Ничего не найдено" : "Откалиброванных ячеек пока нет"}
            </div>`}
      </div>
    `;
  }

  private renderRow({ component, location }: ComponentOverview) {
    return html`
      <tr>
        <td>
          <div>${component.name}</div>
          ${component.tags.map((tag) => html`<span class="tag">${tag}</span> `)}
        </td>
        <td class="num"><strong>${this.format.pieces(component.quantity)}</strong></td>
        <td class="num">${this.format.pieceWeight(component.piece_weight)}</td>
        <td class="nowrap">
          ${location
            ? this.format.location(location.boxName, location.locker.locker_id)
            : html`<span class="pill warn">вне бокса</span>`}
        </td>
        <td class="mono">${component.nfc_id}</td>
        <td class="muted nowrap">${this.format.moment(component.calibrated_at)}</td>
        <td class="nowrap">
          <button
            class="danger"
            title="Забыть, что лежит в ячейке, чтобы откалибровать её заново"
            @click=${() =>
              this.events.releaseComponent(this, {
                nfcId: component.nfc_id,
                label: `«${component.name}» (${component.nfc_id})`,
              })}
          >
            Освободить
          </button>
        </td>
      </tr>
    `;
  }

  private filtered(): ComponentOverview[] {
    const query = this.query.trim().toLowerCase();
    if (!query) {
      return this.items;
    }
    return this.items.filter(({ component }) =>
      [component.name, component.nfc_id, ...component.tags].some((value) => value.toLowerCase().includes(query)),
    );
  }
}
