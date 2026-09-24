import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { InventoryEvent } from "../api/types";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

/** Inventory journal: every pull-out, insertion, quantity change and calibration, newest first. */
export class EventLog extends LitElement {
  static override properties = {
    events: { attribute: false },
    boxNames: { attribute: false },
    boxFilter: { state: true },
    typeFilter: { state: true },
    query: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      .delta {
        font-weight: 700;
      }

      .change {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
        white-space: nowrap;
      }

      .component {
        overflow-wrap: break-word;
      }

      .note {
        margin-top: 4px;
        font-size: 12.5px;
      }

      td.when {
        font-family: var(--mono);
        font-size: 12.5px;
      }

      /* Phone card: event and time, component, place and the change */
      @media (max-width: 720px) {
        td.what {
          grid-column: 1;
          grid-row: 1;
        }

        td.when {
          grid-column: 2;
          grid-row: 1;
        }

        td.component {
          grid-column: 1 / -1;
        }

        td.where {
          grid-column: 1;
          font-size: 12.5px;
          color: var(--muted);
        }

        td.qty {
          grid-column: 2;
        }
      }

      .delta.plus {
        color: var(--tone-good);
      }

      .delta.minus {
        color: var(--tone-bad);
      }
    `,
  ];

  declare events: InventoryEvent[];
  declare boxNames: Map<string, string>;
  declare boxFilter: string;
  declare typeFilter: string;
  declare query: string;

  private readonly format = new Formatter();
  private lastSeenId: number | null = null;

  constructor() {
    super();
    this.events = [];
    this.boxNames = new Map();
    this.boxFilter = "";
    this.typeFilter = "";
    this.query = "";
  }

  protected override render() {
    const visible = this.filtered();
    return html`
      <div class="section-title">
        <h2>Журнал<span class="count" title="Последние события">${this.events.length}</span></h2>
        <div class="filters">
          <select @change=${(event: Event) => (this.boxFilter = (event.target as HTMLSelectElement).value)}>
            <option value="">Все боксы</option>
            ${[...this.boxNames].map(
              ([id, name]) => html`<option value=${id} ?selected=${id === this.boxFilter}>${name}</option>`,
            )}
          </select>
          <select @change=${(event: Event) => (this.typeFilter = (event.target as HTMLSelectElement).value)}>
            <option value="">Все события</option>
            ${this.format
              .eventTypes()
              .map(
                ([type, label]) => html`<option value=${type} ?selected=${type === this.typeFilter}>${label}</option>`,
              )}
          </select>
          <input
            type="search"
            placeholder="Компонент или метка"
            .value=${this.query}
            @input=${(event: Event) => (this.query = (event.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="card table-wrap">
        ${visible.length
          ? html`<table class="cards">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Событие</th>
                  <th>Компонент</th>
                  <th>Где</th>
                  <th class="num">Количество</th>
                  <th class="num">Вес</th>
                </tr>
              </thead>
              <tbody>
                ${repeat(
                  visible,
                  (item) => item.id,
                  (item) => this.renderRow(item),
                )}
              </tbody>
            </table>`
          : html`<div class="empty">${this.events.length ? "Нет событий под фильтр" : "Событий пока нет"}</div>`}
      </div>
    `;
  }

  protected override updated(): void {
    const newest = this.events[0]?.id ?? null;
    if (this.lastSeenId !== null && newest !== null && newest > this.lastSeenId) {
      for (const row of this.renderRoot.querySelectorAll<HTMLTableRowElement>("tr[data-id]")) {
        if (Number(row.dataset.id) > this.lastSeenId) {
          row.animate([{ background: "var(--accent-soft)" }, { background: "transparent" }], {
            duration: 2500,
            easing: "ease-out",
          });
        }
      }
    }
    this.lastSeenId = newest ?? this.lastSeenId;
  }

  private renderRow(item: InventoryEvent) {
    const [label, tone] = this.format.eventLabel(item.event_type);
    return html`
      <tr data-id=${item.id}>
        <td class="when muted nowrap end" title=${this.format.date(item.created_at).toLocaleString("ru-RU")}>
          ${this.format.moment(item.created_at)}
        </td>
        <td class="what">
          <span class="pill ${tone}">${label}</span>
          ${item.note ? html`<div class="note muted">${item.note}</div>` : nothing}
        </td>
        <td class="component">
          ${item.component_name ?? (item.nfc_id ? html`<span class="muted">не откалибрована</span>` : nothing)}
          ${item.nfc_id ? html`<div class="muted mono">${item.nfc_id}</div>` : nothing}
        </td>
        <td class="where nowrap">${this.format.location(this.boxNames.get(item.box_id) ?? item.box_id, item.locker_id)}</td>
        <td class="qty num end ${item.quantity_before === null && item.quantity_after === null ? "phone-hidden" : ""}">
          ${this.renderChange(item)}
        </td>
        <td class="num muted phone-hidden">${this.format.weight(item.weight)}</td>
      </tr>
    `;
  }

  /** Delta in pieces and "before → after"; a dash when the event does not change the count. */
  private renderChange(item: InventoryEvent) {
    if (item.quantity_before === null && item.quantity_after === null) {
      return html`<span class="muted">—</span>`;
    }
    if (item.event_type === "assembly_started") {
      // What the cell held when the assembly started; how many to take is in the note
      return html`<span class="muted">было ${this.format.pieces(item.quantity_before)}</span>`;
    }
    const range = html`<span class="muted">${item.quantity_before ?? "—"} → ${item.quantity_after ?? "—"}</span>`;
    if (item.quantity_delta === null || item.quantity_delta === 0) {
      return range;
    }
    const direction = item.quantity_delta > 0 ? "plus" : "minus";
    return html`<span class="change">
      <span class="delta ${direction}">${this.format.delta(item.quantity_delta)} шт</span>${range}
    </span>`;
  }

  private filtered(): InventoryEvent[] {
    const query = this.query.trim().toLowerCase();
    return this.events.filter(
      (item) =>
        (!this.boxFilter || item.box_id === this.boxFilter) &&
        (!this.typeFilter || item.event_type === this.typeFilter) &&
        (!query ||
          [item.component_name, item.nfc_id, item.note].some((value) => value?.toLowerCase().includes(query) ?? false)),
    );
  }
}
