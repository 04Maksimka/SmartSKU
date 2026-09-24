import { LitElement, css, html, nothing } from "lit";

import { DashboardEvents } from "../app/dashboard-events";
import type { LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import type { CalibrationStep } from "../api/types";
import { AssemblyScreen } from "../app/assembly-screen";
import { CalibrationPlan } from "../app/calibration-plan";
import { SegmentDisplay } from "./segment-display";
import { Theme } from "./theme";

/** One locker of a box: which cell is inside, what it holds and how many pieces are left. */
export class LockerTile extends LitElement {
  static override properties = { overview: { attribute: false } };

  // Display prompts of a calibration step, as the box shows them
  private static readonly STEP_PROMPTS: Record<CalibrationStep, string> = {
    remove_cell: "OUt ",
    insert_filled: " In ",
    measure_pieces: "HOLd",
  };

  static override styles = [
    Theme.shared,
    css`
      /* The tile adapts to its own width (two tiles per row on a phone are ~150px wide) */
      :host {
        container-type: inline-size;
      }

      .tile {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: var(--shadow);
      }

      .tile.out {
        border-style: dashed;
        background: var(--surface-2);
        box-shadow: none;
      }

      /* Assembly: the slots to take from stand out, the rest fade like their dark displays */
      .tile.task-take,
      .tile.task-put {
        border: 2px solid var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }

      .tile.task-put {
        border-color: var(--tone-bad);
        box-shadow: 0 0 0 3px var(--tone-bad-bg);
      }

      .tile.task-done {
        border-color: var(--tone-good);
      }

      .tile.task-none,
      .tile.not-found {
        opacity: 0.5;
      }

      /* Search: the tile stands out, the display replica blinks like the real one */
      .tile.found {
        border: 2px solid var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }

      .found-label {
        margin: 8px 8px 0;
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        background: var(--accent-soft);
      }

      @media (prefers-reduced-motion: no-preference) {
        .tile.found .display-panel sku-segment-display {
          animation: blink 0.8s steps(1, end) infinite;
        }
      }

      @keyframes blink {
        50% {
          opacity: 0;
        }
      }

      .task {
        margin: 8px 8px 0;
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        background: var(--accent-soft);
      }

      .task.put {
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      .task.done {
        background: var(--tone-good-bg);
        color: var(--tone-good);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
      }

      .slot {
        font-family: var(--mono);
        font-weight: 600;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        white-space: nowrap;
      }

      .presence {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--muted);
        white-space: nowrap;
      }

      /* Dark panel echoing the physical display of the slot */
      .display-panel {
        margin: 0 8px;
        border-radius: 8px;
        background: var(--panel, #0c0d10);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04), inset 0 8px 24px rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        gap: 8px;
        padding: 16px 10px 14px;
      }

      .display-panel sku-segment-display {
        height: 46px;
        aspect-ratio: 278 / 104;
      }

      .display-panel .unit {
        font-family: var(--mono);
        font-size: 12px;
        color: #8a8f99;
      }

      .details {
        flex: 1;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }

      /* Long component names wrap between words and clamp to three lines; the full name is in the tooltip */
      .name {
        font-size: 14.5px;
        font-weight: 650;
        line-height: 1.3;
        overflow-wrap: anywhere;
        hyphens: auto;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .name.muted {
        font-weight: 550;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .tags .tag {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      dl {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 4px 10px;
        margin: 0;
        font-size: 13px;
      }

      dt {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding-top: 2px;
        white-space: nowrap;
      }

      dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
      }

      dd.mono {
        font-size: 12px;
      }

      .note {
        padding: 8px 10px;
        border-radius: var(--r-xs, 6px);
        font-size: 12.5px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }

      .note.warn {
        background: var(--tone-warn-bg);
        color: var(--tone-warn);
      }

      .note.info {
        background: var(--tone-info-bg);
        color: var(--tone-info);
      }

      .note.bad {
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      .note .link {
        display: inline;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 650;
        text-decoration: underline;
        cursor: pointer;
      }

      .procedure {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-radius: var(--r-xs, 6px);
        border-left: 3px solid var(--accent);
        background: var(--accent-soft);
        font-size: 12.5px;
        overflow-wrap: anywhere;
      }

      .procedure strong {
        font-size: 13.5px;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        border-top: 1px solid var(--border-2, var(--border));
        font-size: 12px;
      }

      .updated {
        font-family: var(--mono);
        font-size: 11px;
        white-space: nowrap;
      }

      .actions {
        display: flex;
        gap: 6px;
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }

      .dot.green {
        background: #2f9e6e;
        box-shadow: 0 0 0 3px rgba(47, 158, 110, 0.18);
      }

      .dot.amber {
        background: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }

      /* Narrow tile (phone): smaller digits, labels above values, buttons across the whole width */
      @container (max-width: 210px) {
        .display-panel {
          padding: 12px 8px 10px;
        }

        .display-panel sku-segment-display {
          height: 34px;
        }

        .details {
          padding: 10px;
        }

        .name {
          font-size: 13.5px;
        }

        .footer {
          flex-direction: column;
          align-items: stretch;
          padding: 8px 10px 10px;
        }

        .actions {
          flex-direction: column;
        }

        .actions button {
          width: 100%;
        }
      }

      /* Very narrow tile: labels above values */
      @container (max-width: 150px) {
        dl {
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
        }

        dt {
          padding-top: 6px;
        }

        dd {
          text-align: left;
        }
      }
    `,
  ];

  declare overview: LockerOverview;

  private readonly format = new Formatter();
  private readonly events = new DashboardEvents();
  private readonly screen = new AssemblyScreen();
  private signature = "";

  protected override render() {
    const { locker } = this.overview;
    return html`
      <div class="tile ${locker.nfc_flag ? "" : "out"} ${this.taskClass()} ${this.searchClass()}">
        <div class="head">
          <span class="slot">Слот ${this.format.slot(locker.locker_id)}</span>
          ${this.renderPresence()}
        </div>
        ${this.renderDisplay()} ${this.renderTask()}
        ${this.overview.search === "match"
          ? html`<div class="found-label">🔍 Ищем: дисплей мигает</div>`
          : nothing}
        <div class="details">
          ${locker.nfc_flag ? this.renderInserted() : this.renderPulledOut()}
          ${locker.calibration ? this.renderCalibration() : this.renderSetupNote()}
        </div>
        <div class="footer">
          <span class="updated muted" title="Последние показания слота">${this.format.time(locker.updated_at)}</span>
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
        Новая ячейка: взвесьте её пустой, иначе детали не посчитать.
        <button class="link" @click=${() => this.events.scaleSetup(this, this.overview)}>Взвесить пустую</button>
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

  private searchClass(): string {
    const search = this.overview.search;
    return search === "match" ? "found" : search === "other" ? "not-found" : "";
  }

  private taskClass(): string {
    const assembly = this.overview.assembly;
    if (assembly === null) {
      return "";
    }
    return assembly.pick === null ? "task-none" : `task-${this.screen.state(assembly.pick)}`;
  }

  /** The assembly's task for this slot in words, under the display that shows it as "t 20". */
  private renderTask() {
    const pick = this.overview.assembly?.pick ?? null;
    if (pick === null) {
      return nothing;
    }
    const state = this.screen.state(pick);
    return html`<div class="task ${state}">
      ${state === "done" ? "✓ Взято для сборки" : `Сборка: ${this.screen.hint(pick)}`}
    </div>`;
  }

  /** Replica of the slot's seven-segment display, by the same rules as the firmware (Locker::refreshDisplay). */
  private renderDisplay() {
    const { locker } = this.overview;
    const counted =
      locker.nfc_flag &&
      locker.component !== null &&
      locker.quantity !== null &&
      !locker.calibration &&
      this.overview.assembly === null;
    return html`<div class="display-panel">
      <sku-segment-display .text=${this.displayText()}></sku-segment-display>
      ${counted ? html`<span class="unit">шт</span>` : nothing}
    </div>`;
  }

  /** Dashes when there is nothing to count (no cell, not calibrated), the calibration prompt, or the count. */
  private displayText(): string {
    const { locker } = this.overview;
    if (locker.calibration) {
      return LockerTile.STEP_PROMPTS[locker.calibration.step];
    }
    if (this.overview.assembly !== null) {
      return this.screen.text(this.overview.assembly.pick);
    }
    if (!locker.nfc_flag || locker.component === null || locker.quantity === null) {
      return "----";
    }
    return locker.quantity > SegmentDisplay.MAX_NUMBER ? " OFL" : String(locker.quantity);
  }

  /** Whether the cell is in the slot: green = in place, amber = pulled out. */
  private renderPresence() {
    return this.overview.locker.nfc_flag
      ? html`<span class="presence"><span class="dot green"></span>на месте</span>`
      : html`<span class="presence"><span class="dot amber"></span>вынута</span>`;
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
      this.overview.assembly?.pick?.remaining,
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
        <div class="name muted">Не откалибрована</div>
        <dl>
          <dt>Вес</dt>
          <dd>${weight}</dd>
          <dt>Метка</dt>
          <dd class="mono">${locker.nfc_id}</dd>
        </dl>
      `;
    }
    return html`
      <div class="name" title=${component.name}>${component.name}</div>
      ${component.tags.length
        ? html`<div class="tags">${component.tags.map((tag) => html`<span class="tag">${tag}</span>`)}</div>`
        : nothing}
      <dl>
        <dt>Вес</dt>
        <dd>${weight}</dd>
        <dt>1 шт</dt>
        <dd>${this.format.pieceWeight(component.piece_weight)}</dd>
        <dt>Метка</dt>
        <dd class="mono">${locker.nfc_id}</dd>
      </dl>
    `;
  }

  private renderPulledOut() {
    const removal = this.overview.lastRemoval;
    if (removal === null) {
      return html`<div class="name muted">Слот пуст</div>`;
    }
    const name = removal.component_name ?? "Не откалибрована";
    return html`
      <div class="name muted" title=${name}>${name}</div>
      <dl>
        <dt>Вынута</dt>
        <dd>${this.format.moment(removal.created_at)}</dd>
        ${removal.quantity_before === null
          ? nothing
          : html`<dt>Было</dt>
              <dd>${this.format.pieces(removal.quantity_before)}</dd>`}
        <dt>Метка</dt>
        <dd class="mono">${removal.nfc_id ?? "—"}</dd>
      </dl>
    `;
  }
}
