import { LitElement, css, html, nothing } from "lit";

import { DashboardEvents } from "../app/dashboard-events";
import type { LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
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
        gap: 10px;
        padding: 14px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--surface-2);
      }

      .tile.out {
        border-style: dashed;
        background: transparent;
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .slot {
        font-weight: 700;
        white-space: nowrap;
      }

      .name {
        font-size: 16px;
        font-weight: 650;
        line-height: 1.25;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .quantity {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }

      .quantity strong {
        font-size: 34px;
        line-height: 1;
        font-weight: 750;
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
      }

      dd {
        margin: 0;
        text-align: right;
      }

      .pending,
      .no-zero {
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 13px;
        background: var(--tone-warn-bg);
        color: var(--tone-warn);
      }

      .footer {
        margin-top: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
      }
    `,
  ];

  declare overview: LockerOverview;

  private readonly format = new Formatter();
  private readonly events = new DashboardEvents();
  private signature = "";

  protected override render() {
    const { locker, pendingCalibration } = this.overview;
    if (!locker.zeroed) {
      return this.renderWithoutZero();
    }
    return html`
      <div class="tile ${locker.nfc_flag ? "" : "out"}">
        <div class="head">
          <span class="slot">Слот ${this.format.slot(locker.locker_id)}</span>
          ${locker.nfc_flag
            ? html`<span class="pill good">● на месте</span>`
            : html`<span class="pill warn">○ извлечена</span>`}
        </div>
        ${pendingCalibration
          ? html`<div class="pending">
              Ждёт калибровки: «${pendingCalibration.name}», ${pendingCalibration.num_of_pieces} шт.<br />
              Извлеките ячейку, насыпьте компоненты и вставьте обратно.
            </div>`
          : nothing}
        ${locker.nfc_flag ? this.renderInserted() : this.renderPulledOut()}
        <div class="footer">
          <span class="muted">обновлено ${this.format.time(locker.updated_at)}</span>
          ${this.renderAction()}
        </div>
      </div>
    `;
  }

  private renderAction() {
    const { locker, pendingCalibration } = this.overview;
    const component = locker.component;
    if (pendingCalibration) {
      return html`<button
        @click=${() =>
          this.events.cancelCalibration(this, { id: pendingCalibration.id, label: pendingCalibration.name })}
      >
        Отменить
      </button>`;
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
    return html`
      ${locker.nfc_flag ? this.renderTareButton("") : nothing}
      <button class="primary" @click=${() => this.events.calibrate(this, this.overview)}>Откалибровать</button>
    `;
  }

  /** Until the zero is set the weight is meaningless: no accounting and no calibration, only the tare action. */
  private renderWithoutZero() {
    const { locker } = this.overview;
    return html`
      <div class="tile ${locker.nfc_flag ? "" : "out"}">
        <div class="head">
          <span class="slot">Слот ${this.format.slot(locker.locker_id)}</span>
          <span class="pill warn">⚠ нет нуля</span>
        </div>
        <div class="no-zero">
          Ноль не установлен, учёт по слоту не ведётся.
          ${locker.nfc_flag
            ? "Уберите всё из ячейки и нажмите «Установить ноль»."
            : "Вставьте пустую ячейку, затем установите ноль."}
        </div>
        ${locker.nfc_flag
          ? html`<dl>
              <dt>Ячейка</dt>
              <dd class="mono">${locker.nfc_id}</dd>
            </dl>`
          : nothing}
        <div class="footer">
          <span class="muted">обновлено ${this.format.time(locker.updated_at)}</span>
          ${this.renderTareButton("primary")}
        </div>
      </div>
    `;
  }

  private renderTareButton(variant: string) {
    const { locker, boxName } = this.overview;
    return html`<button
      class=${variant}
      ?disabled=${!locker.nfc_flag}
      title=${locker.nfc_flag ? "Запомнить вес пустой ячейки как ноль" : "Сначала вставьте пустую ячейку"}
      @click=${() => this.events.tare(this, { boxId: locker.box_id, lockerId: locker.locker_id, boxName })}
    >
      Установить ноль
    </button>`;
  }

  protected override updated(): void {
    const { locker, pendingCalibration } = this.overview;
    const signature = [locker.nfc_flag, locker.nfc_id, locker.quantity, locker.component?.name, pendingCalibration?.id]
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
    if (component === null) {
      return html`
        <div class="name muted">Не откалибрована</div>
        <dl>
          <dt>Вес</dt>
          <dd>${this.format.weight(locker.weight)}</dd>
          <dt>Ячейка</dt>
          <dd class="mono">${locker.nfc_id}</dd>
        </dl>
      `;
    }
    return html`
      <div class="name">${component.name}</div>
      ${component.tags.length
        ? html`<div class="tags">${component.tags.map((tag) => html`<span class="tag">${tag}</span>`)}</div>`
        : nothing}
      <div class="quantity"><strong>${locker.quantity ?? "—"}</strong><span class="muted">шт</span></div>
      <dl>
        <dt>Вес</dt>
        <dd>${this.format.weight(locker.weight)}</dd>
        <dt>1 штука</dt>
        <dd>${this.format.pieceWeight(component.piece_weight)}</dd>
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
