import { LitElement, css, html } from "lit";

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

  static override styles = [
    Theme.shared,
    css`
      .name {
        overflow-wrap: break-word;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }

      td.qty strong {
        font-family: var(--mono);
        font-size: 15px;
      }

      /* Phone card: name and count on top, then where it lies, the piece weight and the tag */
      @media (max-width: 720px) {
        td.name-cell {
          grid-column: 1;
          grid-row: 1;
        }

        td.qty {
          grid-column: 2;
          grid-row: 1;
        }

        td.qty strong {
          font-size: 18px;
        }

        td.where,
        td.nfc {
          grid-column: 1;
          font-size: 12.5px;
        }

        td.piece,
        td.calibrated {
          grid-column: 2;
          font-size: 12.5px;
        }

        td.release {
          grid-column: 1 / -1;
          margin-top: 4px;
        }
      }
    `,
  ];

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
        <h2>Компоненты<span class="count">${this.items.length}</span></h2>
        <input
          type="search"
          placeholder="Название, тег или метка"
          .value=${this.query}
          @input=${(event: Event) => (this.query = (event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="card table-wrap">
        ${visible.length
          ? html`<table class="cards">
              <thead>
                <tr>
                  <th>Компонент</th>
                  <th class="num">Количество</th>
                  <th class="num">1 штука</th>
                  <th>Где</th>
                  <th>Метка</th>
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
        <td class="name-cell">
          <div class="name">${component.name}</div>
          ${component.tags.length
            ? html`<div class="tags">${component.tags.map((tag) => html`<span class="tag">${tag}</span>`)}</div>`
            : ""}
        </td>
        <td class="qty num end"><strong>${this.format.pieces(component.quantity)}</strong></td>
        <td class="piece num end" data-label="1 шт">${this.format.pieceWeight(component.piece_weight)}</td>
        <td class="where nowrap">
          ${location
            ? this.format.location(location.boxName, location.locker.locker_id)
            : html`<span class="pill warn">вне бокса</span>`}
        </td>
        <td class="nfc mono muted">${component.nfc_id}</td>
        <td class="calibrated muted nowrap end" title="Калибровка">${this.format.moment(component.calibrated_at)}</td>
        <td class="release nowrap end">
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
