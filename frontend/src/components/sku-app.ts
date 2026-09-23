import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Calibration } from "../api/types";
import type { CommandService } from "../app/command-service";
import { DashboardEvents, type CancelCalibrationRequest, type ReleaseComponentRequest } from "../app/dashboard-events";
import type { DashboardSnapshot, DashboardStore, LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import type { BoxSetupDialog } from "./box-setup-dialog";
import type { CalibrationDialog } from "./calibration-dialog";
import type { ScaleSetupDialog } from "./scale-setup-dialog";
import { Theme } from "./theme";

export class SkuApp extends LitElement {
  static override properties = {
    store: { attribute: false },
    commands: { attribute: false },
    referenceGrams: { attribute: false },
    snapshot: { state: true },
    actionError: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      :host {
        max-width: 1400px;
        margin: 0 auto;
        padding-block: 0 48px;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 50;
        background: rgba(233, 234, 236, 0.86);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--border);
        margin-inline: -20px;
        padding-inline: 20px;
        margin-bottom: 20px;
      }

      @media (prefers-color-scheme: dark) {
        .topbar {
          background: rgba(12, 13, 16, 0.86);
        }
      }

      .topbar-inner {
        display: flex;
        align-items: center;
        gap: 18px;
        height: 54px;
        max-width: 1400px;
        margin: 0 auto;
      }

      .brandmark {
        display: flex;
        align-items: center;
        gap: 9px;
        font-family: var(--mono);
        font-weight: 600;
        font-size: 15px;
        letter-spacing: 0.22em;
        color: var(--text);
        text-decoration: none;
        flex: none;
      }

      .brandmark img {
        height: 22px;
        width: auto;
        display: block;
      }

      .toolbar {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
      }

      .error {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: var(--r-sm, 9px);
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      section + section {
        margin-top: 32px;
      }

      .boxes {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
        gap: 16px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
      }

      .split {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 680px), 1fr));
        gap: 32px 16px;
      }

      code, .mono {
        font-family: var(--mono);
      }

      .section-title h2 {
        letter-spacing: -0.01em;
      }
    `,
  ];

  declare store: DashboardStore;
  declare commands: CommandService;
  declare referenceGrams: number;
  declare snapshot: DashboardSnapshot;
  declare actionError: string | null;

  private readonly format = new Formatter();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.actionError = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.store.subscribe((snapshot) => (this.snapshot = snapshot));
    this.addEventListener(DashboardEvents.CALIBRATE, this.handleCalibrate);
    this.addEventListener(DashboardEvents.SHOW_CALIBRATION, this.handleShowCalibration);
    this.addEventListener(DashboardEvents.SCALE_SETUP, this.handleScaleSetup);
    this.addEventListener(DashboardEvents.CANCEL_CALIBRATION, this.handleCancelCalibration);
    this.addEventListener(DashboardEvents.RELEASE_COMPONENT, this.handleReleaseComponent);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.removeEventListener(DashboardEvents.CALIBRATE, this.handleCalibrate);
    this.removeEventListener(DashboardEvents.SHOW_CALIBRATION, this.handleShowCalibration);
    this.removeEventListener(DashboardEvents.SCALE_SETUP, this.handleScaleSetup);
    this.removeEventListener(DashboardEvents.CANCEL_CALIBRATION, this.handleCancelCalibration);
    this.removeEventListener(DashboardEvents.RELEASE_COMPONENT, this.handleReleaseComponent);
  }

  private readonly handleCalibrate = (event: Event): void => {
    this.actionError = null;
    const locker = (event as CustomEvent<LockerOverview | null>).detail;
    void this.openDialog(locker);
  };

  private readonly handleShowCalibration = (event: Event): void => {
    const calibration = (event as CustomEvent<Calibration>).detail;
    this.renderRoot.querySelector<CalibrationDialog>("sku-calibration-dialog")?.openProgress(calibration);
  };

  private readonly handleScaleSetup = (event: Event): void => {
    this.openScaleSetup((event as CustomEvent<LockerOverview>).detail);
  };

  private openScaleSetup(locker: LockerOverview | null): void {
    this.actionError = null;
    this.renderRoot.querySelector<ScaleSetupDialog>("sku-scale-setup-dialog")?.open(locker);
  }

  private readonly handleCancelCalibration = (event: Event): void => {
    const request = (event as CustomEvent<CancelCalibrationRequest>).detail;
    if (confirm(`Отменить калибровку «${request.label}»?`)) {
      void this.run(() => this.commands.cancelCalibration(request.id));
    }
  };

  private readonly handleReleaseComponent = (event: Event): void => {
    const request = (event as CustomEvent<ReleaseComponentRequest>).detail;
    if (confirm(`Освободить ячейку: ${request.label}? Бэкенд забудет, что в ней лежит.`)) {
      void this.run(() => this.commands.releaseComponent(request.nfcId));
    }
  };

  private async run(action: () => Promise<void>): Promise<void> {
    this.actionError = null;
    try {
      await action();
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : String(error);
    }
  }

  private async openDialog(locker: LockerOverview | null): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<CalibrationDialog>("sku-calibration-dialog")?.open(locker);
  }

  private readonly openSetup = (): void => {
    this.actionError = null;
    this.renderRoot.querySelector<BoxSetupDialog>("sku-box-setup-dialog")?.open();
  };

  private lockers(): LockerOverview[] {
    return this.snapshot.boxes.flatMap((box) => box.lockers);
  }

  protected override render() {
    return html`
      <div class="topbar">
        <div class="topbar-inner">
          <span class="brandmark">
            <img src="/logo_mark.png" alt="S" />
            SCUBOX
          </span>
          <div class="toolbar">
            <button @click=${this.openSetup}>Подключить бокс</button>
            <button title="Ноль и гиря для тензодатчиков, вес пустых ячеек" @click=${() => this.openScaleSetup(null)}>
              Настройка весов
            </button>
            <button class="primary" @click=${() => void this.openDialog(null)}>Калибровка</button>
            ${this.renderStatus()}
          </div>
        </div>
      </div>

      ${this.renderDashboard()}
    `;
  }

  private renderStatus() {
    const snapshot = this.snapshot;
    return html`
      <div class="status muted">
        ${snapshot.error
          ? html`<span class="pill bad">○ нет связи с бэкендом</span>`
          : snapshot.updatedAt
            ? html`<span class="pill good">● онлайн</span>`
            : html`<span class="pill">загрузка…</span>`}
        ${snapshot.updatedAt ? html`<span>данные на ${this.format.time(snapshot.updatedAt)}</span>` : nothing}
        <span>обновление раз в ${this.store.refreshIntervalMs / 1000} с</span>
      </div>
    `;
  }

  private renderDashboard() {
    const snapshot = this.snapshot;
    return html`
      ${this.actionError ? html`<div class="error">${this.actionError}</div>` : nothing}
      ${snapshot.error
        ? html`<div class="error">Не удалось обновить данные: ${snapshot.error}. Показаны последние полученные.</div>`
        : nothing}

      <section>
        <div class="section-title"><h2>Боксы <span class="muted">${snapshot.boxes.length}</span></h2></div>
        ${snapshot.boxes.length
          ? html`<div class="boxes">
              ${repeat(
                snapshot.boxes,
                (item) => item.box.id,
                (item) => html`<sku-box-card .overview=${item}></sku-box-card>`,
              )}
            </div>`
          : html`<div class="card empty empty-state">
              <div>Устройств нет. Зажмите BOOT на плате бокса на 3 секунды и подключите его по Bluetooth.</div>
              <button class="primary" @click=${this.openSetup}>Подключить бокс</button>
            </div>`}
      </section>

      <section class="split">
        <sku-component-table .items=${snapshot.components}></sku-component-table>
        <sku-calibration-list
          .calibrations=${snapshot.calibrations}
          .boxNames=${snapshot.boxNames}
        ></sku-calibration-list>
      </section>

      <sku-calibration-dialog
        .lockers=${this.lockers()}
        .calibrations=${snapshot.calibrations}
        .events=${snapshot.events}
        .service=${this.commands}
      ></sku-calibration-dialog>

      <sku-scale-setup-dialog
        .boxes=${snapshot.boxes}
        .service=${this.commands}
        .referenceGrams=${this.referenceGrams}
      ></sku-scale-setup-dialog>

      <sku-box-setup-dialog .service=${this.commands}></sku-box-setup-dialog>

      <section>
        <sku-event-log .events=${snapshot.events} .boxNames=${snapshot.boxNames}></sku-event-log>
      </section>
    `;
  }
}
