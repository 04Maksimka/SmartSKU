import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { ScaleAction } from "../api/types";
import type { CommandService } from "../app/command-service";
import type { BoxOverview, LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

type Stage = "select" | "zero" | "reference" | "cells";

interface SlotResult {
  state: "busy" | "ok" | "error";
  text: string;
}

/**
 * Load cell setup, a rare service operation: when a box is new, when readings drift, or for a new cell.
 *   1. zero      — cells pulled out: the box remembers the empty load cells;
 *   2. reference — the reference weight on each slot in turn: counts per gram and the load cell direction;
 *   3. cells     — empty cells inserted: their weight goes to their NFC tags.
 * Every step can be skipped when the slot already has it, e.g. drift needs only a new zero. Each measurement is one
 * request that waits for the box's answer (a few seconds).
 */
export class ScaleSetupDialog extends LitElement {
  static override properties = {
    boxes: { attribute: false },
    service: { attribute: false },
    referenceGrams: { attribute: false },
    stage: { state: true },
    boxId: { state: true },
    picked: { state: true },
    weigh: { state: true },
    results: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      dialog {
        width: min(620px, calc(100vw - 32px));
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--r, 14px);
        background: var(--surface);
        color: var(--text);
      }

      dialog::backdrop {
        background: rgba(12, 13, 16, 0.5);
      }

      .body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      h2 {
        margin: 0;
        font-size: 19px;
      }

      p {
        margin: 0;
        line-height: 1.5;
      }

      .rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .row {
        display: grid;
        grid-template-columns: 70px 1fr auto;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--border);
        font-size: 13px;
      }

      .row label {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .ok {
        color: var(--tone-good);
      }

      .error {
        color: var(--tone-bad);
      }

      .boxes {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
    `,
  ];

  declare boxes: BoxOverview[];
  declare service: CommandService;
  declare referenceGrams: number;
  declare stage: Stage;
  declare boxId: string | null;
  declare picked: number[];
  /** Cells to weigh on the "cells" step; a locker missing here follows its default (a cell without a tare). */
  declare weigh: Map<number, boolean>;
  declare results: Map<string, SlotResult>;

  private readonly format = new Formatter();

  constructor() {
    super();
    this.boxes = [];
    this.referenceGrams = 100;
    this.stage = "select";
    this.boxId = null;
    this.picked = [];
    this.weigh = new Map();
    this.results = new Map();
  }

  /** From a tile: that slot only, starting with what it lacks. Otherwise the slot list of the first box. */
  open(preselected: LockerOverview | null): void {
    this.weigh = new Map();
    this.results = new Map();
    if (preselected) {
      this.boxId = preselected.locker.box_id;
      this.picked = [preselected.locker.locker_id];
      this.stage = preselected.locker.slot_ready ? "cells" : "zero";
    } else {
      this.selectBox(this.boxes[0]?.box.id ?? null);
      this.stage = "select";
    }
    this.renderRoot.querySelector("dialog")?.showModal();
  }

  protected override render() {
    return html`<dialog><div class="body">${this.renderStage()}</div></dialog>`;
  }

  private renderStage() {
    switch (this.stage) {
      case "select":
        return this.renderSelect();
      case "zero":
        return this.renderZero();
      case "reference":
        return this.renderReference();
      case "cells":
        return this.renderCells();
    }
  }

  private renderSelect() {
    const lockers = this.boxLockers();
    return html`
      <h2>Настройка весов</h2>
      <p class="muted">
        Нужна для нового бокса, когда показания уплыли, и для новых ячеек. Три шага: ноль пустых датчиков, гиря
        ${this.referenceGrams} г на каждый слот, вес пустых ячеек в их метки. Шаг можно пропустить, если слот его уже
        прошёл: при дрейфе хватит нового нуля, ячейки с деталями взвешивать не нужно.
      </p>
      ${
        this.boxes.length > 1
          ? html`<div class="boxes">
              ${this.boxes.map(
                ({ box }) =>
                  html`<button class=${box.id === this.boxId ? "primary" : ""} @click=${() => this.selectBox(box.id)}>
                    ${box.hardware_id}
                  </button>`,
              )}
            </div>`
          : nothing
      }
      ${
        lockers.length
          ? this.renderRows(
              (item) => html`
                <label>
                  <input
                    type="checkbox"
                    .checked=${this.picked.includes(item.locker.locker_id)}
                    @change=${(event: Event) => this.toggle(item.locker.locker_id, (event.target as HTMLInputElement).checked)}
                  />
                  ${item.locker.slot_ready ? "настроен" : html`<span class="error">не настроен</span>`}
                </label>
              `,
              () => nothing,
              lockers,
            )
          : html`<p class="muted">Нет боксов, приславших показания слотов.</p>`
      }
      <div class="actions">
        <button @click=${() => this.close()}>Закрыть</button>
        <button class="primary" ?disabled=${!this.pickedLockers().length} @click=${() => (this.stage = "zero")}>
          Начать
        </button>
      </div>
    `;
  }

  private renderZero() {
    const lockers = this.pickedLockers();
    const inserted = lockers.filter((item) => item.locker.nfc_flag);
    return html`
      <h2>Шаг 1 из 3 · Ноль</h2>
      <p>
        Выньте ячейки из слотов ${this.slotList(lockers)} и уберите всё с площадок. Бокс запомнит показания пустых
        датчиков.
      </p>
      ${this.renderRows(
        (item) => (item.locker.nfc_flag ? html`<span class="error">выньте ячейку</span>` : html`пусто`),
        (item) => this.renderResult("zero", item),
      )}
      <div class="actions">
        <button @click=${() => (this.stage = "select")}>Назад</button>
        <button
          ?disabled=${!this.allDone("zero", (item) => item.locker.slot_ready)}
          title="Ноль у этих слотов уже есть"
          @click=${() => (this.stage = "reference")}
        >
          Пропустить
        </button>
        <button
          class="primary"
          ?disabled=${inserted.length > 0 || this.busy()}
          @click=${() => void this.measureAll("zero", lockers, "reference")}
        >
          Запомнить ноль
        </button>
      </div>
    `;
  }

  private renderReference() {
    return html`
      <h2>Шаг 2 из 3 · Гиря ${this.referenceGrams} г</h2>
      <p>
        Ставьте гирю по очереди на пустую площадку каждого слота и нажимайте «Гиря стоит». Пока бокс меряет (1–2
        секунды), слот не трогайте. Если слот уже настроен, гирю можно не ставить: ноль обновлён, масштаб прежний.
      </p>
      ${this.renderRows(
        (item) =>
          item.locker.nfc_flag
            ? html`<span class="error">выньте ячейку</span>`
            : html`<button
                ?disabled=${this.busy()}
                @click=${() => void this.measure("reference", item, this.referenceGrams)}
              >
                Гиря стоит
              </button>`,
        (item) => this.renderResult("reference", item),
      )}
      <div class="actions">
        <button @click=${() => (this.stage = "zero")}>Назад</button>
        <button
          class="primary"
          ?disabled=${this.busy() || !this.allDone("reference", (item) => item.locker.slot_ready)}
          @click=${() => (this.stage = "cells")}
        >
          Далее
        </button>
      </div>
    `;
  }

  private renderCells() {
    const toWeigh = this.pickedLockers().filter((item) => this.weighs(item));
    return html`
      <h2>Шаг 3 из 3 · Ячейки</h2>
      <p>
        Уберите гирю и вставьте ячейки. Новые ячейки должны быть пустыми: бокс взвесит их и запишет вес в NFC-метку,
        дальше ячейку можно ставить в любой слот. Ячейки с деталями не взвешивайте — свой вес они уже знают.
      </p>
      ${this.renderRows(
        (item) =>
          item.locker.nfc_flag
            ? html`<label>
                <input
                  type="checkbox"
                  .checked=${this.weighs(item)}
                  @change=${(event: Event) =>
                    this.setWeigh(item.locker.locker_id, (event.target as HTMLInputElement).checked)}
                />
                ${item.locker.cell_tared ? "вес в метке есть" : html`<span class="error">новая ячейка</span>`}
              </label>`
            : html`<span class="muted">нет ячейки</span>`,
        (item) => this.renderResult("cells", item),
      )}
      <div class="actions">
        <button @click=${() => (this.stage = "reference")}>Назад</button>
        <button
          ?disabled=${!toWeigh.length || this.busy()}
          @click=${() => void this.measureAll("cells", toWeigh, null)}
        >
          Взвесить отмеченные
        </button>
        <button class="primary" ?disabled=${this.busy()} @click=${() => this.close()}>Готово</button>
      </div>
    `;
  }

  private renderRows(
    middle: (item: LockerOverview) => TemplateResult | typeof nothing,
    right: (item: LockerOverview) => TemplateResult | typeof nothing,
    lockers: LockerOverview[] = this.pickedLockers(),
  ) {
    return html`<div class="rows">
      ${lockers.map(
        (item) =>
          html`<div class="row">
            <strong>Слот ${this.format.slot(item.locker.locker_id)}</strong>
            <span>${middle(item)}</span>
            <span>${right(item)}</span>
          </div>`,
      )}
    </div>`;
  }

  private renderResult(stage: Stage, item: LockerOverview) {
    const result = this.results.get(this.key(stage, item.locker.locker_id));
    if (result === undefined) {
      return nothing;
    }
    if (result.state === "busy") {
      return html`<span class="muted">меряем…</span>`;
    }
    return html`<span class=${result.state}>${result.state === "ok" ? "✓ " : "✗ "}${result.text}</span>`;
  }

  private async measureAll(stage: Stage, lockers: LockerOverview[], next: Stage | null): Promise<void> {
    // Every slot measures on its own, the box handles them in parallel
    const results = await Promise.all(lockers.map((item) => this.measure(stage, item, null)));
    if (next !== null && results.every(Boolean)) {
      this.stage = next;
    }
  }

  private async measure(stage: Stage, item: LockerOverview, grams: number | null): Promise<boolean> {
    const { box_id: boxId, locker_id: lockerId } = item.locker;
    const action: ScaleAction = stage === "cells" ? "cell_tare" : stage === "reference" ? "reference" : "zero";
    this.setResult(stage, lockerId, { state: "busy", text: "" });
    try {
      const result = await this.service.scale(boxId, lockerId, action, grams);
      const text =
        action === "zero"
          ? "ноль запомнен"
          : action === "reference"
            ? `1 г = ${Math.abs(result.value).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} отсчётов`
            : `ячейка весит ${this.format.weight(result.value)}`;
      this.setResult(stage, lockerId, { state: "ok", text });
      if (stage === "cells") {
        this.setWeigh(lockerId, false);
      }
      return true;
    } catch (error) {
      this.setResult(stage, lockerId, {
        state: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** Every picked slot passed this stage now, or already had what it gives. */
  private allDone(stage: Stage, alreadyHas: (item: LockerOverview) => boolean): boolean {
    return this.pickedLockers().every(
      (item) => this.results.get(this.key(stage, item.locker.locker_id))?.state === "ok" || alreadyHas(item),
    );
  }

  private busy(): boolean {
    return [...this.results.values()].some((result) => result.state === "busy");
  }

  private weighs(item: LockerOverview): boolean {
    return item.locker.nfc_flag && (this.weigh.get(item.locker.locker_id) ?? !item.locker.cell_tared);
  }

  private setWeigh(lockerId: number, value: boolean): void {
    this.weigh = new Map(this.weigh).set(lockerId, value);
  }

  private setResult(stage: Stage, lockerId: number, result: SlotResult): void {
    this.results = new Map(this.results).set(this.key(stage, lockerId), result);
  }

  private key(stage: Stage, lockerId: number): string {
    return `${stage}:${lockerId}`;
  }

  private selectBox(boxId: string | null): void {
    this.boxId = boxId;
    this.picked = this.boxLockers().map((item) => item.locker.locker_id);
  }

  private toggle(lockerId: number, checked: boolean): void {
    this.picked = checked
      ? [...this.picked, lockerId].sort((a, b) => a - b)
      : this.picked.filter((id) => id !== lockerId);
  }

  private boxLockers(): LockerOverview[] {
    return this.boxes.find((item) => item.box.id === this.boxId)?.lockers ?? [];
  }

  private pickedLockers(): LockerOverview[] {
    return this.boxLockers().filter((item) => this.picked.includes(item.locker.locker_id));
  }

  private slotList(lockers: LockerOverview[]): string {
    return lockers.map((item) => this.format.slot(item.locker.locker_id)).join(", ");
  }

  private close(): void {
    this.renderRoot.querySelector("dialog")?.close();
  }
}
