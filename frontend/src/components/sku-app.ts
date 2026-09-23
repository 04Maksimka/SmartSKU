import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Calibration } from "../api/types";
import type { CommandService } from "../app/command-service";
import { DashboardEvents, type CancelCalibrationRequest, type ReleaseComponentRequest } from "../app/dashboard-events";
import type { DashboardSnapshot, DashboardStore, LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { ThemePreference, type ThemeChoice } from "../app/theme-preference";
import type { BoxSetupDialog } from "./box-setup-dialog";
import type { CalibrationDialog } from "./calibration-dialog";
import type { ScaleSetupDialog } from "./scale-setup-dialog";
import { Theme } from "./theme";

type Tab = "boxes" | "components" | "journal";

export class SkuApp extends LitElement {
  /** Tabs of the dashboard; the chosen one lives in the URL hash, so a reload or a link keeps it. */
  private static readonly TABS: { id: Tab; label: string }[] = [
    { id: "boxes", label: "Склад" },
    { id: "components", label: "Компоненты" },
    { id: "journal", label: "Журнал" },
  ];

  static override properties = {
    store: { attribute: false },
    commands: { attribute: false },
    referenceGrams: { attribute: false },
    snapshot: { state: true },
    actionError: { state: true },
    tab: { state: true },
    theme: { state: true },
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
        background: color-mix(in srgb, var(--bg) 86%, transparent);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--border);
        margin-inline: calc(-1 * var(--gutter, 20px));
        padding-inline: var(--gutter, 20px);
        margin-bottom: 20px;
      }

      .topbar-inner {
        display: flex;
        align-items: center;
        gap: 18px;
        min-height: 58px;
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
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .tabs {
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 10px;
        background: var(--chip);
      }

      .tabs a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 8px;
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
        transition: background 0.15s, color 0.15s;
      }

      .tabs a:hover {
        color: var(--text);
      }

      .tabs a[aria-current="page"] {
        background: var(--surface);
        color: var(--text);
        box-shadow: 0 1px 2px rgba(20, 23, 28, 0.12);
      }

      .tabs .badge {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--muted);
      }

      .theme-switch {
        width: 34px;
        height: 34px;
        padding: 0;
        font-size: 16px;
        line-height: 1;
        flex: none;
      }

      /* On phones the actions leave the sticky header and open the "Склад" tab instead */
      .actions-inline {
        display: none;
      }

      .toolbar button {
        white-space: nowrap;
      }

      .status {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        white-space: nowrap;
      }

      .status .clock {
        font-family: var(--mono);
      }

      /* Phones: logo and status on the first row, the three actions share the second one */
      @media (max-width: 720px) {
        .topbar-inner {
          flex-wrap: wrap;
          gap: 10px 12px;
          padding-block: 10px;
        }

        .toolbar {
          display: none;
        }

        .tabs {
          order: 3;
          width: 100%;
        }

        .tabs a {
          flex: 1;
          justify-content: center;
          padding: 8px 6px;
        }

        .actions-inline {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
          margin-bottom: 16px;
        }

        .actions-inline button {
          padding: 9px 6px;
          font-size: 12.5px;
          line-height: 1.2;
        }

        .status .clock {
          display: none;
        }
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 28px;
      }

      .metric {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .metric .label {
        font-family: var(--mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .metric .value {
        font-family: var(--mono);
        font-size: 24px;
        font-weight: 600;
        line-height: 1.2;
        letter-spacing: -0.01em;
      }

      .metric .value small {
        font-size: 14px;
        color: var(--muted);
        font-weight: 500;
      }

      .metric.attention .value {
        color: var(--tone-warn);
      }

      .metric.bad .value {
        color: var(--tone-bad);
      }

      @media (max-width: 720px) {
        .summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 22px;
        }

        .metric {
          padding: 10px 12px;
        }

        .metric .value {
          font-size: 20px;
        }
      }

      .error {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: var(--r-sm, 9px);
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      section + section {
        margin-top: 36px;
      }

      .boxes {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr));
        gap: 16px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
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
  declare tab: Tab;
  declare theme: ThemeChoice;

  private readonly format = new Formatter();
  private readonly themePreference = new ThemePreference();
  private static readonly THEME_LABELS: Record<ThemeChoice, { icon: string; title: string }> = {
    system: { icon: "◐", title: "Тема как в системе" },
    light: { icon: "☀", title: "Светлая тема" },
    dark: { icon: "☾", title: "Тёмная тема" },
  };
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.actionError = null;
    this.tab = this.tabFromHash();
    this.theme = this.themePreference.current();
    this.themePreference.apply(this.theme);
  }

  private readonly switchTheme = (): void => {
    this.theme = this.themePreference.next(this.theme);
    this.themePreference.set(this.theme);
  };

  private renderThemeSwitch() {
    const { icon, title } = SkuApp.THEME_LABELS[this.theme];
    const next = SkuApp.THEME_LABELS[this.themePreference.next(this.theme)].title.toLowerCase();
    return html`<button
      class="theme-switch"
      title="${title}. Нажмите: ${next}"
      aria-label=${title}
      @click=${this.switchTheme}
    >
      ${icon}
    </button>`;
  }

  private tabFromHash(): Tab {
    const id = location.hash.slice(1);
    return SkuApp.TABS.find((tab) => tab.id === id)?.id ?? "boxes";
  }

  private readonly handleHashChange = (): void => {
    this.tab = this.tabFromHash();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.store.subscribe((snapshot) => (this.snapshot = snapshot));
    this.addEventListener(DashboardEvents.CALIBRATE, this.handleCalibrate);
    this.addEventListener(DashboardEvents.SHOW_CALIBRATION, this.handleShowCalibration);
    this.addEventListener(DashboardEvents.SCALE_SETUP, this.handleScaleSetup);
    this.addEventListener(DashboardEvents.CANCEL_CALIBRATION, this.handleCancelCalibration);
    this.addEventListener(DashboardEvents.RELEASE_COMPONENT, this.handleReleaseComponent);
    window.addEventListener("hashchange", this.handleHashChange);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("hashchange", this.handleHashChange);
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
            <img src="/logo_mark.png" alt="" />
            SKUBOX
          </span>
          ${this.renderTabs()}
          ${this.renderStatus()}
          ${this.renderThemeSwitch()}
          <div class="toolbar">${this.renderActions()}</div>
        </div>
      </div>

      ${this.renderDashboard()}
    `;
  }

  private renderTabs() {
    const counts: Record<Tab, number | null> = {
      boxes: null,
      components: this.snapshot.components.length,
      journal: null,
    };
    return html`
      <nav class="tabs">
        ${SkuApp.TABS.map(
          (tab) => html`<a href="#${tab.id}" aria-current=${tab.id === this.tab ? "page" : "false"}>
            ${tab.label}${counts[tab.id] ? html`<span class="badge">${counts[tab.id]}</span>` : nothing}
          </a>`,
        )}
      </nav>
    `;
  }

  private renderActions() {
    return html`
      <button @click=${this.openSetup}>Подключить бокс</button>
      <button title="Ноль и гиря для тензодатчиков, вес пустых ячеек" @click=${() => this.openScaleSetup(null)}>
        Настройка весов
      </button>
      <button class="primary" @click=${() => void this.openDialog(null)}>Калибровка</button>
    `;
  }

  private renderStatus() {
    const snapshot = this.snapshot;
    const refresh = `Дашборд обновляется раз в ${this.store.refreshIntervalMs / 1000} с`;
    // This is the dashboard's link to the server; each box shows its own status on its card
    return html`
      <div class="status muted" title=${refresh}>
        ${snapshot.error
          ? html`<span class="pill bad">○ нет связи с сервером</span>`
          : snapshot.updatedAt
            ? html`<span class="pill good">● сервер на связи</span>`
            : html`<span class="pill">загрузка…</span>`}
        ${snapshot.updatedAt ? html`<span class="clock">${this.format.time(snapshot.updatedAt)}</span>` : nothing}
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

      ${this.renderTab()}

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
    `;
  }

  private renderTab() {
    const snapshot = this.snapshot;
    switch (this.tab) {
      case "components":
        return html`
          <section>
            <sku-component-table .items=${snapshot.components}></sku-component-table>
          </section>
          <section>
            <sku-calibration-list
              .calibrations=${snapshot.calibrations}
              .boxNames=${snapshot.boxNames}
            ></sku-calibration-list>
          </section>
        `;
      case "journal":
        return html`<section>
          <sku-event-log .events=${snapshot.events} .boxNames=${snapshot.boxNames}></sku-event-log>
        </section>`;
      default:
        return html`
          <div class="actions-inline">${this.renderActions()}</div>
          ${snapshot.boxes.length ? this.renderSummary() : nothing}
          <section>
            <div class="section-title"><h2>Боксы<span class="count">${snapshot.boxes.length}</span></h2></div>
            ${snapshot.boxes.length
              ? html`<div class="boxes">
                  ${repeat(
                    snapshot.boxes,
                    (item) => item.box.id,
                    (item) => html`<sku-box-card .overview=${item}></sku-box-card>`,
                  )}
                </div>`
              : html`<div class="card empty empty-state">
                  <div>Устройств нет. Зажмите кнопку подключения на боксе на 3 секунды и подключите его по Bluetooth.</div>
                  <button class="primary" @click=${this.openSetup}>Подключить бокс</button>
                </div>`}
          </section>
        `;
    }
  }

  /** The state of the whole warehouse at a glance. */
  private renderSummary() {
    const boxes = this.snapshot.boxes;
    const lockers = this.lockers();
    const online = boxes.filter(({ box }) => box.online).length;
    const inserted = lockers.filter(({ locker }) => locker.nfc_flag).length;
    const attention = lockers.filter(
      ({ locker }) => !locker.slot_ready || (locker.nfc_flag && (!locker.cell_tared || locker.tag_error)),
    ).length;
    return html`
      <div class="summary">
        <div class="card metric ${online < boxes.length ? "bad" : ""}">
          <span class="label">Боксы в сети</span>
          <span class="value">${online}<small> / ${boxes.length}</small></span>
        </div>
        <div class="card metric">
          <span class="label">Ячейки на месте</span>
          <span class="value">${inserted}<small> / ${lockers.length}</small></span>
        </div>
        <div class="card metric">
          <span class="label">Компоненты</span>
          <span class="value">${this.snapshot.components.length}</span>
        </div>
        <div class="card metric ${attention ? "attention" : ""}" title="Слот не настроен, ячейка не взвешена пустой или метка не читается">
          <span class="label">Требуют внимания</span>
          <span class="value">${attention}</span>
        </div>
      </div>
    `;
  }
}
