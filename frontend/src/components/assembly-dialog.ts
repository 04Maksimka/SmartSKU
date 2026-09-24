import { LitElement, css, html, nothing } from "lit";

import type { Assembly, Availability, ItemAvailability, Specification } from "../api/types";
import type { CommandService } from "../app/command-service";
import { Formatter } from "../app/formatter";
import { DialogStyles } from "./dialog-styles";
import { Theme } from "./theme";

/** A cell the assembly will light up and how many pieces to take from it. */
interface PlannedPick {
  item: ItemAvailability;
  boxId: string;
  lockerId: number;
  take: number;
}

/**
 * Starts an assembly by a specification: how many products, whether the stands hold enough (and exactly what is
 * missing if not), and which cells will light up.
 */
export class AssemblyDialog extends LitElement {
  static override properties = {
    service: { attribute: false },
    boxNames: { attribute: false },
    activeAssembly: { attribute: false },
    specification: { state: true },
    kits: { state: true },
    availability: { state: true },
    loading: { state: true },
    error: { state: true },
    busy: { state: true },
  };

  static override styles = [
    Theme.shared,
    DialogStyles.shared,
    css`
      .kits {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .stepper {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .stepper button {
        width: 34px;
        height: 34px;
        padding: 0;
        font-size: 17px;
      }

      .stepper input {
        width: 72px;
        text-align: center;
        font-family: var(--mono);
        font-size: 16px;
      }

      td.state {
        text-align: right;
        white-space: nowrap;
      }

      tr.short td {
        background: var(--tone-bad-bg);
      }

      .plan {
        margin: 6px 0 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .plan li {
        display: flex;
        gap: 10px;
        align-items: baseline;
      }

      .plan .where {
        font-family: var(--mono);
        font-weight: 600;
        min-width: 7.5em;
      }

      .plan .take {
        margin-left: auto;
        font-family: var(--mono);
        font-weight: 700;
        white-space: nowrap;
      }
    `,
  ];

  declare service: CommandService;
  declare boxNames: Map<string, string>;
  declare activeAssembly: Assembly | null;
  declare specification: Specification | null;
  declare kits: number;
  declare availability: Availability | null;
  declare loading: boolean;
  declare error: string | null;
  declare busy: boolean;

  private readonly format = new Formatter();
  // Only the answer to the latest request is shown when the count is changed quickly
  private request = 0;

  constructor() {
    super();
    this.boxNames = new Map();
    this.activeAssembly = null;
    this.specification = null;
    this.kits = 1;
    this.availability = null;
    this.loading = false;
    this.error = null;
    this.busy = false;
  }

  open(specification: Specification): void {
    this.specification = specification;
    this.kits = 1;
    this.availability = null;
    this.error = null;
    this.busy = false;
    this.dialog()?.showModal();
    void this.check();
  }

  protected override render() {
    const specification = this.specification;
    return html`<dialog>
      <div class="body">
        ${specification
          ? html`
              <h2>Сборка «${specification.name}»</h2>
              <div class="kits">
                <span class="muted">Сколько изделий</span>
                <span class="stepper">
                  <button aria-label="Меньше" ?disabled=${this.kits <= 1} @click=${() => this.setKits(this.kits - 1)}>
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputmode="numeric"
                    .value=${String(this.kits)}
                    @change=${(event: Event) => this.setKits(Number((event.target as HTMLInputElement).value))}
                  />
                  <button aria-label="Больше" @click=${() => this.setKits(this.kits + 1)}>+</button>
                </span>
              </div>
              ${this.renderCheck()}
            `
          : nothing}
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        <div class="actions">
          <button @click=${() => this.dialog()?.close()}>Отмена</button>
          <button class="primary" ?disabled=${!this.canStart()} @click=${this.start}>Начать сборку</button>
        </div>
      </div>
    </dialog>`;
  }

  private renderCheck() {
    const availability = this.availability;
    if (availability === null) {
      return html`<div class="muted">${this.loading ? "Проверяем склад…" : ""}</div>`;
    }
    return html`
      <div class="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Компонент</th>
              <th class="num">Нужно</th>
              <th class="num">На стендах</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${availability.items.map(
              (item) => html`<tr class=${item.missing ? "short" : ""}>
                <td>${item.component_name}</td>
                <td class="num mono">${item.required}</td>
                <td class="num mono">${item.available}</td>
                <td class="state">
                  ${item.missing
                    ? html`<span class="pill bad">−${item.missing}</span>`
                    : html`<span class="pill good">✓</span>`}
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${availability.ok ? this.renderPlan(availability) : this.renderShortage(availability)}
      ${this.activeAssembly
        ? html`<div class="note warn">
            Сейчас идёт сборка «${this.format.assemblyTitle(this.activeAssembly.name, this.activeAssembly.kits)}»: она
            занимает дисплеи всех боксов. Завершите или прервите её, чтобы начать новую.
          </div>`
        : nothing}
    `;
  }

  /** Every short component with the numbers, and where the rest of it is when it exists but cannot be used. */
  private renderShortage(availability: Availability) {
    return html`<div class="note bad">
      <strong>Компонентов не хватает — сборку не начать.</strong>
      <ul>
        ${availability.items
          .filter((item) => item.missing)
          .map(
            (item) => html`<li>
              <strong>${item.component_name}</strong>: нужно ${item.required}, на стендах ${item.available}, не хватает
              <strong>${item.missing}</strong>${item.elsewhere
                ? html` · ещё ${item.elsewhere} шт в ячейках, которые вынуты, не взвешены или в боксах без связи`
                : item.available === 0
                  ? " · такого компонента на складе нет"
                  : ""}
            </li>`,
          )}
      </ul>
    </div>`;
  }

  /** Which cells will light up, in the order of the boxes. */
  private renderPlan(availability: Availability) {
    const picks = this.plan(availability).sort(
      (left, right) =>
        this.boxName(left.boxId).localeCompare(this.boxName(right.boxId), "ru", { numeric: true }) ||
        left.lockerId - right.lockerId,
    );
    return html`<div class="note good">
      <strong>Всего хватает.</strong> Подсветятся ячейки — на их дисплеях будет «t» и сколько взять, остальные дисплеи
      погаснут:
      <ul class="plan">
        ${picks.map(
          (pick) => html`<li>
            <span class="where">${this.format.location(this.boxName(pick.boxId), pick.lockerId)}</span>
            <span>${pick.item.component_name}</span>
            <span class="take">t ${pick.take}</span>
          </li>`,
        )}
      </ul>
    </div>`;
  }

  /** The same split as the backend: the fullest cells first. */
  private plan(availability: Availability): PlannedPick[] {
    const picks: PlannedPick[] = [];
    for (const item of availability.items) {
      let need = item.required;
      for (const cell of item.cells) {
        const take = Math.min(need, cell.quantity);
        if (need === 0) {
          break;
        }
        if (take > 0) {
          picks.push({ item, boxId: cell.box_id, lockerId: cell.locker_id, take });
          need -= take;
        }
      }
    }
    return picks;
  }

  private canStart(): boolean {
    return (
      !this.busy && !this.loading && this.availability !== null && this.availability.ok && this.activeAssembly === null
    );
  }

  private setKits(kits: number): void {
    this.kits = Number.isInteger(kits) && kits >= 1 ? Math.min(kits, 1000) : 1;
    void this.check();
  }

  private async check(): Promise<void> {
    const specification = this.specification;
    if (specification === null) {
      return;
    }
    const request = ++this.request;
    this.loading = true;
    this.error = null;
    try {
      const availability = await this.service.availability(specification.id, this.kits);
      if (request === this.request) {
        this.availability = availability;
      }
    } catch (error) {
      if (request === this.request) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === this.request) {
        this.loading = false;
      }
    }
  }

  private readonly start = async (): Promise<void> => {
    const specification = this.specification;
    if (specification === null) {
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      await this.service.startAssembly(specification.id, this.kits);
      this.dialog()?.close();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      // The stock may have changed since the check
      void this.check();
    } finally {
      this.busy = false;
    }
  };

  private boxName(boxId: string): string {
    return this.boxNames.get(boxId) ?? boxId;
  }

  private dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }
}
