import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { EmulatorClient } from "../api/emulator-client";
import type { CommandService } from "../app/command-service";
import {
  DashboardEvents,
  type CancelCalibrationRequest,
  type ReleaseComponentRequest,
  type TareRequest,
} from "../app/dashboard-events";
import type { DashboardSnapshot, DashboardStore, LockerOverview } from "../app/dashboard-store";
import type { EmulatorStore } from "../app/emulator-store";
import { Formatter } from "../app/formatter";
import type { CalibrationDialog } from "./calibration-dialog";
import { Theme } from "./theme";

export class SkuApp extends LitElement {
  static override properties = {
    store: { attribute: false },
    commands: { attribute: false },
    emulatorStore: { attribute: false },
    emulatorApi: { attribute: false },
    snapshot: { state: true },
    actionError: { state: true },
    actionNotice: { state: true },
    tab: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      :host {
        max-width: 1400px;
        margin: 0 auto;
        padding-block: 20px 48px;
      }

      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }

      h1 {
        margin: 0;
        font-size: 24px;
        letter-spacing: -0.01em;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .tabs {
        display: flex;
        gap: 4px;
        padding: 3px;
        border-radius: 10px;
        background: var(--chip);
      }

      .tabs button {
        border: none;
        background: transparent;
        color: var(--muted);
      }

      .tabs button.active {
        background: var(--surface);
        color: var(--text);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      }

      .notice {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        background: var(--tone-info-bg);
        color: var(--tone-info);
      }

      .error {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 10px;
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

      .split {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 680px), 1fr));
        gap: 32px 16px;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `,
  ];

  declare store: DashboardStore;
  declare commands: CommandService;
  declare emulatorStore: EmulatorStore | null;
  declare emulatorApi: EmulatorClient | null;
  declare snapshot: DashboardSnapshot;
  declare actionError: string | null;
  declare actionNotice: string | null;
  declare tab: "dashboard" | "emulator";

  private readonly format = new Formatter();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.actionError = null;
    this.actionNotice = null;
    this.emulatorStore = null;
    this.emulatorApi = null;
    this.tab = location.hash === "#emulator" ? "emulator" : "dashboard";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.store.subscribe((snapshot) => (this.snapshot = snapshot));
    window.addEventListener("hashchange", this.handleHashChange);
    this.syncEmulatorPolling();
    this.addEventListener(DashboardEvents.CALIBRATE, this.handleCalibrate);
    this.addEventListener(DashboardEvents.TARE, this.handleTare);
    this.addEventListener(DashboardEvents.CANCEL_CALIBRATION, this.handleCancelCalibration);
    this.addEventListener(DashboardEvents.RELEASE_COMPONENT, this.handleReleaseComponent);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    window.removeEventListener("hashchange", this.handleHashChange);
    this.emulatorStore?.stop();
    this.removeEventListener(DashboardEvents.CALIBRATE, this.handleCalibrate);
    this.removeEventListener(DashboardEvents.TARE, this.handleTare);
    this.removeEventListener(DashboardEvents.CANCEL_CALIBRATION, this.handleCancelCalibration);
    this.removeEventListener(DashboardEvents.RELEASE_COMPONENT, this.handleReleaseComponent);
  }

  private readonly handleHashChange = (): void => {
    this.tab = location.hash === "#emulator" ? "emulator" : "dashboard";
    this.syncEmulatorPolling();
  };

  private openTab(tab: "dashboard" | "emulator"): void {
    location.hash = tab === "emulator" ? "#emulator" : "";
    this.tab = tab;
    this.syncEmulatorPolling();
  }

  /** The emulator is a dev tool: poll it only while its tab is open. */
  private syncEmulatorPolling(): void {
    if (this.emulatorStore === null) {
      return;
    }
    if (this.tab === "emulator") {
      this.emulatorStore.start();
    } else {
      this.emulatorStore.stop();
    }
  }

  private readonly handleCalibrate = (event: Event): void => {
    this.actionError = null;
    const locker = (event as CustomEvent<LockerOverview | null>).detail;
    void this.openDialog(locker);
  };

  private readonly handleTare = (event: Event): void => {
    const { boxId, lockerId, boxName } = (event as CustomEvent<TareRequest>).detail;
    const prompt = `Вставлена ли пустая ячейка в слот ${lockerId} бокса ${boxName}? Уберите из неё все предметы и не трогайте примерно 2 секунды после подтверждения.`;
    if (!confirm(prompt)) {
      return;
    }
    this.actionNotice = null;
    void this.run(async () => {
      await this.commands.tare(boxId, lockerId);
      this.actionNotice = `Команда отправлена боксу ${boxName}. Держите пустую ячейку в слоте ${lockerId} неподвижно около 2 секунд, после этого предупреждение о нуле пропадёт.`;
    });
  };

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

  private lockers(): LockerOverview[] {
    return this.snapshot.boxes.flatMap((box) => box.lockers);
  }

  protected override render() {
    return html`
      <header>
        <h1>SmartSKU</h1>
        <div class="toolbar">
          ${this.emulatorStore
            ? html`<div class="tabs">
                <button
                  class=${this.tab === "dashboard" ? "active" : ""}
                  @click=${() => this.openTab("dashboard")}
                >
                  Склад
                </button>
                <button
                  class=${this.tab === "emulator" ? "active" : ""}
                  @click=${() => this.openTab("emulator")}
                >
                  Эмулятор
                </button>
              </div>`
            : nothing}
          ${this.tab === "dashboard"
            ? html`<button class="primary" @click=${() => void this.openDialog(null)}>Калибровка</button>`
            : nothing}
          ${this.renderStatus()}
        </div>
      </header>

      ${this.tab === "emulator" ? this.renderEmulator() : this.renderDashboard()}
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

  private renderEmulator() {
    return html`<sku-emulator-panel
      .store=${this.emulatorStore}
      .api=${this.emulatorApi}
    ></sku-emulator-panel>`;
  }

  private renderDashboard() {
    const snapshot = this.snapshot;
    return html`
      ${this.actionError ? html`<div class="error">${this.actionError}</div>` : nothing}
      ${this.actionNotice ? html`<div class="notice">${this.actionNotice}</div>` : nothing}
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
          : html`<div class="card empty">
              Боксы ещё не подключались. Для эмулятора: <code>docker compose --profile emulator up -d</code>
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
        .service=${this.commands}
      ></sku-calibration-dialog>

      <section>
        <sku-event-log .events=${snapshot.events} .boxNames=${snapshot.boxNames}></sku-event-log>
      </section>
    `;
  }
}
