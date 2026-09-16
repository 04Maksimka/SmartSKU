import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { EmulatorClient } from "../api/emulator-client";
import type { EmulatorBox, EmulatorCell, EmulatorLocker } from "../api/emulator-types";
import type { EmulatorSnapshot, EmulatorStore } from "../app/emulator-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

/** Replaces the emulator Swagger: pull a cell out, pour components in, put it back. */
export class EmulatorPanel extends LitElement {
  static override properties = {
    store: { attribute: false },
    api: { attribute: false },
    snapshot: { state: true },
    grams: { state: true },
    pieces: { state: true },
    inserts: { state: true },
    newBox: { state: true },
    newCell: { state: true },
    busy: { state: true },
    error: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      .boxes {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 560px), 1fr));
        gap: 16px;
      }

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

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 10px;
      }

      .tile {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--surface-2);
      }

      .tile.out {
        border-style: dashed;
        background: transparent;
      }

      .tile-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .slot {
        font-weight: 700;
        white-space: nowrap;
      }

      /* The one-colour display of a real cell */
      .screen {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 6px;
        background: #12331f;
        color: #7dffb0;
      }

      .weight {
        font-size: 20px;
        font-weight: 700;
      }

      .row {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }

      .row input {
        width: 70px;
        padding: 5px 8px;
      }

      .row button {
        flex: 1 1 auto;
        max-width: 130px;
      }

      .row .unit {
        font-size: 12px;
        color: var(--muted);
      }

      button {
        padding: 5px 10px;
      }

      .toolbar {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        align-items: flex-end;
        margin-bottom: 20px;
      }

      .toolbar .row input {
        width: 220px;
      }

      .error {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      .hint {
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 13px;
        background: var(--tone-info-bg);
        color: var(--tone-info);
        margin-bottom: 16px;
      }

      .loose {
        margin-top: 28px;
      }

      select {
        max-width: 160px;
      }
    `,
  ];

  declare store: EmulatorStore;
  declare api: EmulatorClient;
  declare snapshot: EmulatorSnapshot;
  declare grams: Record<string, string>;
  declare pieces: Record<string, string>;
  declare inserts: Record<string, string>;
  declare newBox: string;
  declare newCell: string;
  declare busy: string | null;
  declare error: string | null;

  private readonly format = new Formatter();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.snapshot = { boxes: [], looseCells: [], updatedAt: null, error: null };
    this.grams = {};
    this.pieces = {};
    this.inserts = {};
    this.newBox = "";
    this.newCell = "";
    this.busy = null;
    this.error = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.store.subscribe((snapshot) => (this.snapshot = snapshot));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  protected override render() {
    const { boxes, looseCells, error } = this.snapshot;
    return html`
      ${error
        ? html`<div class="error">
            Эмулятор недоступен: ${error}. Запустите его:
            <span class="mono">docker compose --profile emulator up -d</span>
          </div>`
        : nothing}
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      <div class="hint">
        Это виртуальное «железо»: вынимайте ячейки, меняйте вес и вставляйте обратно — бэкенд увидит те же данные,
        что прислал бы настоящий бокс.
      </div>
      ${this.renderToolbar()}
      <div class="boxes">
        ${repeat(
          boxes,
          (box) => box.hardware_id,
          (box) => this.renderBox(box),
        )}
      </div>
      ${looseCells.length ? this.renderLooseCells(looseCells) : nothing}
    `;
  }

  private renderToolbar() {
    return html`
      <div class="toolbar">
        <div class="row">
          <input
            placeholder="Новый бокс, например emu-box-002"
            .value=${this.newBox}
            @input=${(event: Event) => (this.newBox = (event.target as HTMLInputElement).value)}
          />
          <button
            ?disabled=${this.busy !== null}
            @click=${() =>
              void this.run("new-box", async () => {
                await this.api.createBox(this.newBox.trim(), 4);
                this.newBox = "";
              })}
          >
            Добавить бокс
          </button>
        </div>
        <div class="row">
          <input
            placeholder="Новая ячейка, например cell-0006"
            .value=${this.newCell}
            @input=${(event: Event) => (this.newCell = (event.target as HTMLInputElement).value)}
          />
          <button
            ?disabled=${this.busy !== null}
            @click=${() =>
              void this.run("new-cell", async () => {
                await this.api.createCell(this.newCell.trim());
                this.newCell = "";
              })}
          >
            Добавить ячейку
          </button>
        </div>
      </div>
    `;
  }

  private renderBox(box: EmulatorBox) {
    return html`
      <section class="card">
        <header>
          <div>
            <h3>${box.hardware_id}</h3>
            <div class="muted mono">${box.box_id ? `box_id ${box.box_id}` : "ещё не зарегистрирован"}</div>
          </div>
          <span class="pill ${box.connected ? "good" : "bad"}">
            ${box.connected ? "● на связи" : "○ нет связи"}
          </span>
        </header>
        <div class="grid">
          ${box.lockers.map((locker) => this.renderLocker(box, locker))}
        </div>
      </section>
    `;
  }

  private renderLocker(box: EmulatorBox, locker: EmulatorLocker) {
    const cell = locker.cell;
    return html`
      <div class="tile ${cell ? "" : "out"}">
        <div class="tile-head">
          <span class="slot">Слот ${locker.locker_id}</span>
          <span class="screen" title="Дисплей ячейки">${locker.screen_number}</span>
        </div>
        ${locker.pending_calibration !== null
          ? html`<span class="pill warn">ждёт ${locker.pending_calibration} шт</span>`
          : nothing}
        ${cell === null
          ? this.renderInsert(box, locker)
          : html`
              <div class="mono muted">${cell.nfc_id}</div>
              <div class="weight">${this.format.grams(cell.weight)}</div>
              <div class="muted" style="font-size: 12px">
                ${locker.calibrated_piece_weight === null
                  ? "не откалибрована"
                  : `1 шт = ${this.format.pieceWeight(locker.calibrated_piece_weight)}`}
              </div>
              ${this.renderCellControls(cell, locker.calibrated_piece_weight)}
              <button
                ?disabled=${this.busy !== null}
                @click=${() => void this.run(`pull-${box.hardware_id}-${locker.locker_id}`, () =>
                  this.api.pullOut(box.hardware_id, locker.locker_id),
                )}
              >
                Вынуть ячейку
              </button>
            `}
      </div>
    `;
  }

  private renderInsert(box: EmulatorBox, locker: EmulatorLocker) {
    const key = `${box.hardware_id}:${locker.locker_id}`;
    const loose = this.snapshot.looseCells;
    if (loose.length === 0) {
      return html`<div class="muted">Пусто. Свободных ячеек на руках нет.</div>`;
    }
    const chosen = this.inserts[key] ?? loose[0].nfc_id;
    return html`
      <div class="muted">Пусто</div>
      <div class="row">
        <select @change=${(event: Event) => this.setInsert(key, (event.target as HTMLSelectElement).value)}>
          ${loose.map(
            (cell) => html`<option value=${cell.nfc_id} ?selected=${cell.nfc_id === chosen}>
              ${cell.nfc_id} · ${this.format.grams(cell.weight)}
            </option>`,
          )}
        </select>
        <button
          ?disabled=${this.busy !== null}
          @click=${() => void this.run(`insert-${key}`, () =>
            this.api.insert(box.hardware_id, locker.locker_id, chosen),
          )}
        >
          Вставить
        </button>
      </div>
    `;
  }

  private renderCellControls(cell: EmulatorCell, pieceWeight: number | null) {
    const grams = this.grams[cell.nfc_id] ?? "50";
    const pieces = this.pieces[cell.nfc_id] ?? "1";
    return html`
      <div class="row">
        <input
          type="number"
          step="0.1"
          .value=${grams}
          @input=${(event: Event) => this.setGrams(cell.nfc_id, (event.target as HTMLInputElement).value)}
        />
        <span class="unit">г</span>
        <button
          ?disabled=${this.busy !== null}
          @click=${() => void this.changeGrams(cell.nfc_id, Number(grams))}
        >
          Насыпать
        </button>
        <button
          ?disabled=${this.busy !== null}
          @click=${() => void this.changeGrams(cell.nfc_id, -Number(grams))}
        >
          Забрать
        </button>
      </div>
      <div class="row">
        <input
          type="number"
          step="1"
          .value=${pieces}
          ?disabled=${pieceWeight === null}
          @input=${(event: Event) => this.setPieces(cell.nfc_id, (event.target as HTMLInputElement).value)}
        />
        <span class="unit">шт</span>
        <button
          ?disabled=${this.busy !== null || pieceWeight === null}
          title=${pieceWeight === null ? "Доступно после калибровки" : "Положить штуки"}
          @click=${() => void this.changePieces(cell.nfc_id, Number(pieces))}
        >
          Положить
        </button>
        <button
          ?disabled=${this.busy !== null || pieceWeight === null}
          title=${pieceWeight === null ? "Доступно после калибровки" : "Взять штуки"}
          @click=${() => void this.changePieces(cell.nfc_id, -Number(pieces))}
        >
          Взять
        </button>
      </div>
    `;
  }

  private renderLooseCells(cells: EmulatorCell[]) {
    return html`
      <section class="loose">
        <div class="section-title"><h2>Ячейки на руках <span class="muted">${cells.length}</span></h2></div>
        <div class="boxes">
          ${repeat(
            cells,
            (cell) => cell.nfc_id,
            (cell) => html`
              <div class="card tile">
                <div class="mono muted">${cell.nfc_id}</div>
                <div class="weight">${this.format.grams(cell.weight)}</div>
                ${this.renderCellControls(cell, this.pieceWeightOf(cell.nfc_id))}
                <div class="muted" style="font-size: 12px">Вставьте её в свободный слот выше.</div>
              </div>
            `,
          )}
        </div>
      </section>
    `;
  }

  /** A pulled-out cell keeps the piece weight of the box that calibrated it. */
  private pieceWeightOf(nfcId: string): number | null {
    for (const box of this.snapshot.boxes) {
      for (const locker of box.lockers) {
        if (locker.cell?.nfc_id === nfcId && locker.calibrated_piece_weight !== null) {
          return locker.calibrated_piece_weight;
        }
      }
    }
    return null;
  }

  private setGrams(nfcId: string, value: string): void {
    this.grams = { ...this.grams, [nfcId]: value };
  }

  private setPieces(nfcId: string, value: string): void {
    this.pieces = { ...this.pieces, [nfcId]: value };
  }

  private setInsert(key: string, value: string): void {
    this.inserts = { ...this.inserts, [key]: value };
  }

  private async changeGrams(nfcId: string, grams: number): Promise<void> {
    if (!Number.isFinite(grams) || grams === 0) {
      this.error = "Укажите, сколько граммов";
      return;
    }
    await this.run(`grams-${nfcId}`, () => this.api.addGrams(nfcId, grams));
  }

  private async changePieces(nfcId: string, pieces: number): Promise<void> {
    if (!Number.isInteger(pieces) || pieces === 0) {
      this.error = "Укажите целое число штук";
      return;
    }
    await this.run(`pieces-${nfcId}`, () => this.api.addPieces(nfcId, pieces));
  }

  private async run(key: string, action: () => Promise<unknown>): Promise<void> {
    this.busy = key;
    this.error = null;
    try {
      await action();
      await this.store.refreshNow();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = null;
    }
  }
}
