import { LitElement, css, html, nothing } from "lit";

import type { Calibration } from "../api/types";
import type { CommandService } from "../app/command-service";
import type { LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

type Step = "pick" | "form" | "await";

/** The calibration scenario from CLAUDE.md: pick a free locker, name the component, pour N pieces, insert. */
export class CalibrationDialog extends LitElement {
  static override properties = {
    lockers: { attribute: false },
    calibrations: { attribute: false },
    service: { attribute: false },
    step: { state: true },
    selected: { state: true },
    name: { state: true },
    tags: { state: true },
    pieces: { state: true },
    startedId: { state: true },
    error: { state: true },
    busy: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      dialog {
        width: min(560px, calc(100vw - 32px));
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--surface);
        color: var(--text);
      }

      dialog::backdrop {
        background: rgba(15, 18, 22, 0.45);
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

      .choices {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 50vh;
        overflow-y: auto;
      }

      .choice {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        width: 100%;
        text-align: left;
        font-weight: 400;
        padding: 10px 12px;
      }

      .choice strong {
        font-size: 14px;
      }

      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: var(--muted);
      }

      label input {
        width: 100%;
      }

      ol {
        margin: 0;
        padding-left: 20px;
        line-height: 1.6;
      }

      .note {
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 13px;
        background: var(--tone-info-bg);
        color: var(--tone-info);
      }

      .note.warn {
        background: var(--tone-warn-bg);
        color: var(--tone-warn);
      }

      .note.good {
        background: var(--tone-good-bg);
        color: var(--tone-good);
      }

      .error {
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 13px;
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
    `,
  ];

  declare lockers: LockerOverview[];
  declare calibrations: Calibration[];
  declare service: CommandService;
  declare step: Step;
  declare selected: LockerOverview | null;
  declare name: string;
  declare tags: string;
  declare pieces: string;
  declare startedId: number | null;
  declare error: string | null;
  declare busy: boolean;

  private readonly format = new Formatter();

  constructor() {
    super();
    this.lockers = [];
    this.calibrations = [];
    this.step = "pick";
    this.selected = null;
    this.name = "";
    this.tags = "";
    this.pieces = "";
    this.startedId = null;
    this.error = null;
    this.busy = false;
  }

  /** Opens the wizard, skipping the locker list when the user started from a tile. */
  open(preselected: LockerOverview | null): void {
    this.selected = preselected;
    this.step = preselected ? "form" : "pick";
    this.name = "";
    this.tags = "";
    this.pieces = "";
    this.startedId = null;
    this.error = null;
    this.busy = false;
    this.dialog()?.showModal();
    void this.focusName();
  }

  protected override render() {
    return html`
      <dialog @close=${() => (this.startedId = null)}>
        <div class="body">${this.renderStep()}</div>
      </dialog>
    `;
  }

  private renderStep() {
    if (this.step === "await") {
      return this.renderProgress();
    }
    return this.step === "pick" ? this.renderPick() : this.renderForm();
  }

  private renderPick() {
    const free = this.freeLockers();
    return html`
      <h2>Калибровка: выберите ячейку</h2>
      ${free.length
        ? html`<div class="choices">
            ${free.map(
              (item) => html`
                <button
                  class="choice"
                  @click=${() => {
                    this.selected = item;
                    this.step = "form";
                    void this.focusName();
                  }}
                >
                  <span>
                    <strong>${this.format.location(item.boxName, item.locker.locker_id)}</strong><br />
                    <span class="muted mono">${item.locker.nfc_id ?? "ячейка извлечена"}</span>
                  </span>
                  <span class="pill ${item.locker.nfc_flag ? "good" : "warn"}">
                    ${item.locker.nfc_flag ? "● на месте" : "○ извлечена"}
                  </span>
                </button>
              `,
            )}
          </div>`
        : html`<div class="note warn">
            Свободных ячеек нет. Освободите ячейку на карточке слота или подключите бокс.
          </div>`}
      <div class="actions"><button @click=${() => this.close()}>Закрыть</button></div>
    `;
  }

  private renderForm() {
    const selected = this.selected;
    if (selected === null) {
      return nothing;
    }
    return html`
      <h2>Калибровка: ${this.format.location(selected.boxName, selected.locker.locker_id)}</h2>
      <label>
        Что кладём
        <input
          id="name"
          placeholder="Например, Болт М3"
          .value=${this.name}
          @input=${(event: Event) => (this.name = (event.target as HTMLInputElement).value)}
          @keydown=${this.submitOnEnter}
        />
      </label>
      <label>
        Теги через запятую, необязательно
        <input
          placeholder="крепёж, м3"
          .value=${this.tags}
          @input=${(event: Event) => (this.tags = (event.target as HTMLInputElement).value)}
          @keydown=${this.submitOnEnter}
        />
      </label>
      <label>
        Сколько штук насыпете для калибровки
        <input
          type="number"
          min="1"
          step="1"
          placeholder="20"
          .value=${this.pieces}
          @input=${(event: Event) => (this.pieces = (event.target as HTMLInputElement).value)}
          @keydown=${this.submitOnEnter}
        />
      </label>
      <div class="note">По этому количеству бокс посчитает вес одной штуки и дальше будет считать остаток сам.</div>
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      <div class="actions">
        <button @click=${() => (this.selected && this.step === "form" ? this.back() : this.close())}>Назад</button>
        <button class="primary" ?disabled=${this.busy} @click=${() => void this.submit()}>
          ${this.busy ? "Отправляем…" : "Запустить калибровку"}
        </button>
      </div>
    `;
  }

  private renderProgress() {
    const calibration = this.calibrations.find((item) => item.id === this.startedId);
    if (calibration === undefined) {
      return html`<h2>Калибровка запущена</h2>
        <div class="actions"><button @click=${() => this.close()}>Закрыть</button></div>`;
    }
    const where = this.format.location(this.boxName(calibration.box_id), calibration.locker_id);
    if (calibration.status === "completed") {
      return html`
        <h2>Калибровка завершена</h2>
        <div class="note good">
          «${calibration.name}» в ${where}: 1 шт =
          ${calibration.piece_weight === null ? "—" : this.format.pieceWeight(calibration.piece_weight)}.
        </div>
        <div class="actions"><button class="primary" @click=${() => this.close()}>Готово</button></div>
      `;
    }
    if (calibration.status === "cancelled") {
      return html`
        <h2>Калибровка отменена</h2>
        <div class="note warn">Заявка на ${where} отменена.</div>
        <div class="actions"><button @click=${() => this.close()}>Закрыть</button></div>
      `;
    }
    return html`
      <h2>Насыпьте компоненты</h2>
      <ol>
        <li>Вытащите ячейку из слота ${calibration.locker_id} бокса ${this.boxName(calibration.box_id)}.</li>
        <li>Насыпьте ровно ${calibration.num_of_pieces} шт. «${calibration.name}».</li>
        <li>Вставьте ячейку обратно — остальное бокс посчитает сам.</li>
      </ol>
      <div class="note">
        Окно можно закрыть, статус виден на карточке слота. В эмуляторе те же шаги — ручки
        <span class="mono">pull-out</span>, <span class="mono">cells/{nfc_id}/grams</span>,
        <span class="mono">insert</span>.
      </div>
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      <div class="actions">
        <button ?disabled=${this.busy} @click=${() => void this.cancel(calibration.id)}>Отменить калибровку</button>
        <button class="primary" @click=${() => this.close()}>Закрыть</button>
      </div>
    `;
  }

  private freeLockers(): LockerOverview[] {
    return this.lockers.filter((item) => item.locker.component === null && item.pendingCalibration === null);
  }

  private boxName(boxId: string): string {
    return this.lockers.find((item) => item.locker.box_id === boxId)?.boxName ?? boxId;
  }

  private readonly submitOnEnter = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      void this.submit();
    }
  };

  private async submit(): Promise<void> {
    const selected = this.selected;
    if (selected === null || this.busy) {
      return;
    }
    const pieces = Number.parseInt(this.pieces, 10);
    if (!this.name.trim()) {
      this.error = "Укажите, что кладёте в ячейку";
      return;
    }
    if (!Number.isFinite(pieces) || pieces <= 0) {
      this.error = "Количество штук должно быть больше нуля";
      return;
    }

    this.busy = true;
    this.error = null;
    try {
      const calibration = await this.service.startCalibration({
        box_id: selected.locker.box_id,
        locker_id: selected.locker.locker_id,
        name: this.name.trim(),
        tags: this.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        num_of_pieces: pieces,
      });
      this.startedId = calibration.id;
      this.step = "await";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private async cancel(calibrationId: number): Promise<void> {
    this.busy = true;
    this.error = null;
    try {
      await this.service.cancelCalibration(calibrationId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private back(): void {
    this.error = null;
    this.step = "pick";
    this.selected = null;
  }

  private close(): void {
    this.dialog()?.close();
  }

  private dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  private async focusName(): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>("#name")?.focus();
  }
}
