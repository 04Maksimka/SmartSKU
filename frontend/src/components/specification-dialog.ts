import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Specification } from "../api/types";
import type { CommandService } from "../app/command-service";
import { DialogStyles } from "./dialog-styles";
import { Theme } from "./theme";

interface Row {
  key: number;
  name: string;
  quantity: string;
}

/** Creates or edits a specification: the product name and how many pieces of each component one product takes. */
export class SpecificationDialog extends LitElement {
  static override properties = {
    service: { attribute: false },
    componentNames: { attribute: false },
    editingId: { state: true },
    name: { state: true },
    rows: { state: true },
    error: { state: true },
    busy: { state: true },
  };

  static override styles = [
    Theme.shared,
    DialogStyles.shared,
    css`
      .rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 50vh;
        overflow-y: auto;
        padding: 2px;
      }

      .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 96px 34px;
        gap: 8px;
        align-items: start;
      }

      .row input {
        width: 100%;
      }

      .row .remove {
        width: 34px;
        height: 34px;
        padding: 0;
        font-size: 16px;
      }

      .unknown {
        grid-column: 1 / -1;
        margin-top: -4px;
        font-size: 12px;
        color: var(--tone-warn);
      }

      .head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 96px 34px;
        gap: 8px;
        font-family: var(--mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .add {
        align-self: flex-start;
      }
    `,
  ];

  declare service: CommandService;
  /** Calibrated components, suggested while typing. */
  declare componentNames: string[];
  declare editingId: number | null;
  declare name: string;
  declare rows: Row[];
  declare error: string | null;
  declare busy: boolean;

  private nextKey = 0;

  constructor() {
    super();
    this.componentNames = [];
    this.editingId = null;
    this.name = "";
    this.rows = [];
    this.error = null;
    this.busy = false;
  }

  /** A new specification, or a copy of this one to edit. */
  open(specification: Specification | null): void {
    this.editingId = specification?.id ?? null;
    this.name = specification?.name ?? "";
    this.rows = specification
      ? specification.items.map((item) => this.row(item.component_name, String(item.quantity)))
      : [this.row("", "")];
    this.error = null;
    this.busy = false;
    this.dialog()?.showModal();
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>("input.product")?.focus());
  }

  protected override render() {
    return html`<dialog>
      <div class="body">
        <h2>${this.editingId === null ? "Новая спецификация" : "Спецификация"}</h2>
        <label>
          Изделие
          <input
            class="product"
            placeholder="Например, стол"
            .value=${this.name}
            @input=${(event: Event) => (this.name = (event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="head"><span>Компонент</span><span>На 1 изделие</span><span></span></div>
        <div class="rows">
          ${repeat(
            this.rows,
            (row) => row.key,
            (row) => this.renderRow(row),
          )}
        </div>
        <button class="add" @click=${this.addRow}>+ Компонент</button>
        <datalist id="components">
          ${this.componentNames.map((name) => html`<option value=${name}></option>`)}
        </datalist>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        <div class="actions">
          <button @click=${() => this.dialog()?.close()}>Отмена</button>
          <button class="primary" ?disabled=${this.busy} @click=${this.save}>Сохранить</button>
        </div>
      </div>
    </dialog>`;
  }

  private renderRow(row: Row) {
    const name = row.name.trim();
    const known = !name || this.componentNames.some((item) => this.key(item) === this.key(name));
    return html`<div class="row">
      <input
        list="components"
        placeholder="Название компонента"
        .value=${row.name}
        @input=${(event: Event) => this.change(row, { name: (event.target as HTMLInputElement).value })}
      />
      <input
        type="number"
        min="1"
        step="1"
        inputmode="numeric"
        placeholder="шт"
        .value=${row.quantity}
        @input=${(event: Event) => this.change(row, { quantity: (event.target as HTMLInputElement).value })}
      />
      <button
        class="remove danger"
        title="Убрать строку"
        aria-label="Убрать строку"
        ?disabled=${this.rows.length === 1}
        @click=${() => (this.rows = this.rows.filter((item) => item !== row))}
      >
        ×
      </button>
      ${known ? nothing : html`<div class="unknown">Такого компонента пока нет на складе — сборка его не найдёт</div>`}
    </div>`;
  }

  private readonly addRow = (): void => {
    this.rows = [...this.rows, this.row("", "")];
    void this.updateComplete.then(() =>
      [...this.renderRoot.querySelectorAll<HTMLInputElement>(".row input[list]")].at(-1)?.focus(),
    );
  };

  private readonly save = async (): Promise<void> => {
    const name = this.name.trim();
    const filled = this.rows.filter((row) => row.name.trim() || row.quantity.trim());
    if (!name) {
      this.error = "Укажите название изделия";
      return;
    }
    if (!filled.length) {
      this.error = "Добавьте хотя бы один компонент";
      return;
    }
    const items = filled.map((row) => ({ component_name: row.name.trim(), quantity: Number(row.quantity) }));
    if (items.some((item) => !item.component_name || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      this.error = "У каждой строки нужны компонент и целое количество от 1";
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      await this.service.saveSpecification(this.editingId, { name, items });
      this.dialog()?.close();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  };

  private change(row: Row, patch: Partial<Row>): void {
    this.rows = this.rows.map((item) => (item === row ? { ...item, ...patch } : item));
  }

  private row(name: string, quantity: string): Row {
    return { key: this.nextKey++, name, quantity };
  }

  /** Same rule as the backend: case and extra spaces do not matter. */
  private key(name: string): string {
    return name.trim().split(/\s+/).join(" ").toLocaleLowerCase("ru");
  }

  private dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }
}
