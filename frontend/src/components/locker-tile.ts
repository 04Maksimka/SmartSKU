import { LitElement, css, html, nothing } from "lit";

import { DashboardEvents } from "../app/dashboard-events";
import type { LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { CalibrationPlan } from "../app/calibration-plan";
import { Theme } from "./theme";

/** One locker of a box: which cell is inside, what it holds and how many pieces are left. */
export class LockerTile extends LitElement {
  static override properties = { overview: { attribute: false } };

  static override styles = [
    Theme.shared,
    css`
      .tile {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: 0 1px 2px rgba(20, 23, 28, 0.04);
      }

      .tile.out {
        border-style: dashed;
        background: transparent;
        box-shadow: none;
      }

      /* ── top bar: SKU name + status dot ── */
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--border-2, var(--border));
      }

      .slot {
        font-family: var(--mono);
        font-weight: 600;
        font-size: 13.5px;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .name {
        font-size: 15px;
        font-weight: 650;
        line-height: 1.25;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      /* ── dark display panel — echo of physical LED ── */
      .display-panel {
        background: var(--panel, #0C0D10);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 18px 12px;
        position: relative;
      }

      .display-panel .qty {
        font-family: var(--mono);
        font-size: 42px;
        font-weight: 700;
        line-height: 1;
        color: var(--led, #FF3B30);
        letter-spacing: 0.04em;
        font-variant-numeric: tabular-nums;
      }

      .display-panel .unit {
        font-family: var(--mono);
        font-size: 12px;
        color: #8A8F99;
        align-self: flex-end;
        margin-bottom: 6px;
      }

      .display-panel .word {
        font-family: var(--mono);
        font-weight: 600;
        letter-spacing: 0.14em;
        font-size: 19px;
      }

      .display-panel .word.amber {
        color: var(--accent);
      }

      .display-panel .word.red {
        color: var(--led);
      }

      .display-panel .word.muted {
        color: #5A6270;
      }

      /* ── bottom bar: address + piece weight ── */
      .info-bar {
        padding: 9px 12px;
        border-top: 1px solid var(--border-2, var(--border));
      }

      .info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .addr, .w1 {
        font-family: var(--mono);
        font-size: 11.5px;
        color: var(--muted);
        letter-spacing: 0.02em;
      }

      /* ── details section ── */
      .details {
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 3px 12px;
        margin: 0;
        font-size: 13px;
      }

      dt {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 11.5px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        padding-top: 2px;
      }

      dd {
        margin: 0;
        text-align: right;
      }

      .note {
        padding: 8px 10px;
        border-radius: var(--r-xs, 6px);
        font-size: 13px;
      }

      .note.warn {
        background: var(--tone-warn-bg);
        color: var(--tone-warn);
      }

      .note.info {
        background: var(--tone-info-bg);
        color: var(--tone-info);
      }

      .note .link {
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 650;
        text-decoration: underline;
        cursor: pointer;
      }

      .note.bad {
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      .procedure {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-radius: var(--r-xs, 6px);
        border-left: 3px solid var(--accent);
        background: var(--accent-soft);
        font-size: 13px;
      }

      .procedure strong {
        font-size: 14px;
      }

      .actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .footer {
        margin-top: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding: 8px 12px;
        border-top: 1px solid var(--border-2, var(--border));
        font-size: 12px;
      }

      /* ── status dot ── */
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
        box-shadow: 0 0 0 3px var(--surface);
      }

      .dot.green { background: #2F9E6E; }
      .dot.amber { background: var(--accent); }
      .dot.red { background: #D2402E; }
      .dot.neutral { background: var(--muted); }
    `,
  ];

  declare overview: LockerOverview;

  private readonly format = new Formatter();
  private readonly events = new DashboardEvents();
  private signature = "";

  protected override render() {
    const { locker } = this.overview;
    const component = locker.component;
    return html`
      <div class="tile ${locker.nfc_flag ? "" : "out"}">
        <div class="head">
          <span class="slot">${component ? component.name : `Слот ${this.format.slot(locker.locker_id)}`}</span>
          ${this.renderPresenceDot()}
        </div>
        ${this.renderDisplay()}
        <div class="details">
          ${locker.calibration ? this.renderCalibration() : this.renderSetupNote()}
          ${locker.nfc_flag ? this.renderInserted() : this.renderPulledOut()}
        </div>
        <div class="footer">
          <span class="muted">обновлено ${this.format.time(locker.updated_at)}</span>
          <span class="actions">${this.renderActions()}</span>
        </div>
      </div>
    `;
  }

  /** The step the box waits for, so the person at the rack knows what to do without opening the dialog. */
  private renderCalibration() {
    const { locker, pendingCalibration } = this.overview;
    const progress = locker.calibration;
    if (progress === null) {
      return nothing;
    }
    const plan = new CalibrationPlan(progress.num_of_pieces, pendingCalibration?.name ?? "");
    const label = `Калибровка${pendingCalibration ? ` «${pendingCalibration.name}»` : ""}`;
    return html`<div class="procedure">
      <div class="muted">${label} · шаг ${plan.position(progress.step)} из ${plan.length}</div>
      <strong>${plan.title(progress.step)}</strong>
    </div>`;
  }

  /** What the slot or the cell still lacks before the weight turns into a count. */
  private renderSetupNote() {
    const { locker, pendingCalibration } = this.overview;
    if (pendingCalibration) {
      return html`<div class="note warn">
        Калибровка «${pendingCalibration.name}» ждёт ответа бокса. Если он не в сети, отмените её.
      </div>`;
    }
    if (locker.nfc_flag && locker.tag_error) {
      return html`<div class="note bad">NFC-метка ячейки не читается: замените метку.</div>`;
    }
    if (!locker.slot_ready) {
      return html`<div class="note info">
        Тензодатчик слота не настроен, вес не считается.
        <button class="link" @click=${() => this.events.scaleSetup(this, this.overview)}>Настроить гирей</button>
      </div>`;
    }
    if (locker.nfc_flag && !locker.cell_tared) {
      return html`<div class="note warn">
        Новая ячейка: в её метке нет веса пустой ячейки, вес и количество не считаются.
        <button class="link" @click=${() => this.events.scaleSetup(this, this.overview)}>Взвесить пустой</button>
      </div>`;
    }
    return nothing;
  }

  private renderActions() {
    const { locker, pendingCalibration } = this.overview;
    const component = locker.component;
    if (pendingCalibration) {
      return html`
        ${locker.calibration
          ? html`<button @click=${() => this.events.showCalibration(this, pendingCalibration)}>Шаги</button>`
          : nothing}
        <button
          @click=${() =>
            this.events.cancelCalibration(this, { id: pendingCalibration.id, label: pendingCalibration.name })}
        >
          Отменить
        </button>
      `;
    }
    if (component) {
      return html`<button
        class="danger"
        title="Забыть, что лежит в ячейке, чтобы откалибровать её заново"
        @click=${() =>
          this.events.releaseComponent(this, {
            nfcId: component.nfc_id,
            label: `«${component.name}» в ${this.format.location(this.overview.boxName, locker.locker_id)}`,
          })}
      >
        Освободить
      </button>`;
    }
    if (!locker.nfc_flag || !locker.slot_ready || !locker.cell_tared) {
      return nothing;
    }
    return html`<button
      class="primary"
      title="Указать компонент и посчитать вес штуки"
      @click=${() => this.events.calibrate(this, this.overview)}
    >
      Откалибровать
    </button>`;
  }

  /** Dark panel echoing the physical LED display. */
  private renderDisplay() {
    const { locker } = this.overview;
    if (!locker.nfc_flag) {
      return html`<div class="display-panel"><span class="word muted">—</span></div>`;
    }
    const component = locker.component;
    if (component === null) {
      return html`<div class="display-panel"><span class="word amber">CAL</span></div>`;
    }
    if (locker.quantity === null) {
      return html`<div class="display-panel"><span class="word amber">—</span><span class="unit">шт</span></div>`;
    }
    return html`<div class="display-panel">
      <span class="qty">${locker.quantity}</span>
      <span class="unit">шт</span>
    </div>`;
  }

  /** Status dot: green = present, amber = pulled out. */
  private renderPresenceDot() {
    return this.overview.locker.nfc_flag
      ? html`<span class="dot green" title="на месте"></span>`
      : html`<span class="dot amber" title="извлечена"></span>`;
  }

  protected override updated(): void {
    const { locker, pendingCalibration } = this.overview;
    const signature = [
      locker.nfc_flag,
      locker.nfc_id,
      locker.quantity,
      locker.component?.name,
      pendingCalibration?.id,
      locker.calibration?.step,
    ]
      .map(String)
      .join("|");
    if (this.signature && signature !== this.signature) {
      this.renderRoot
        .querySelector(".tile")
        ?.animate([{ boxShadow: "0 0 0 3px var(--accent)" }, { boxShadow: "0 0 0 3px transparent" }], {
          duration: 1500,
          easing: "ease-out",
        });
    }
    this.signature = signature;
  }

  private renderInserted() {
    const { locker } = this.overview;
    const component = locker.component;
    const weight = locker.cell_tared && locker.slot_ready ? this.format.weight(locker.weight) : "—";
    if (component === null) {
      return html`
        <div class="info-row">
          <span class="addr">Слот ${this.format.slot(locker.locker_id)}</span>
          <span class="w1">${weight}</span>
        </div>
        <dl>
          <dt>Ячейка</dt>
          <dd class="mono">${locker.nfc_id}</dd>
        </dl>
      `;
    }
    return html`
      ${component.tags.length
        ? html`<div class="tags">${component.tags.map((tag) => html`<span class="tag">${tag}</span>`)}</div>`
        : nothing}
      <div class="info-row">
        <span class="addr">Слот ${this.format.slot(locker.locker_id)}</span>
        <span class="w1">w₁ ${this.format.pieceWeight(component.piece_weight)}</span>
      </div>
      <dl>
        <dt>Вес</dt>
        <dd>${weight}</dd>
        <dt>Ячейка</dt>
        <dd class="mono">${locker.nfc_id}</dd>
      </dl>
    `;
  }

  private renderPulledOut() {
    const removal = this.overview.lastRemoval;
    if (removal === null) {
      return html`<div class="name muted">Пусто</div>`;
    }
    return html`
      <div class="name muted">${removal.component_name ?? "Неоткалиброванная ячейка"}</div>
      <dl>
        <dt>Ячейка</dt>
        <dd class="mono">${removal.nfc_id ?? "—"}</dd>
        <dt>Извлечена</dt>
        <dd>${this.format.moment(removal.created_at)}</dd>
        <dt>Было</dt>
        <dd>${this.format.pieces(removal.quantity_before)}</dd>
      </dl>
    `;
  }
}
