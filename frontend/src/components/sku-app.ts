import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Assembly, Calibration, Cluster } from "../api/types";
import type { CommandService } from "../app/command-service";
import {
  DashboardEvents,
  type CancelCalibrationRequest,
  type PlaceAtRequest,
  type ReleaseComponentRequest,
} from "../app/dashboard-events";
import type { BoxOverview, DashboardSnapshot, DashboardStore, LockerOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { ThemePreference, type ThemeChoice } from "../app/theme-preference";
import type { BoxSetupDialog } from "./box-setup-dialog";
import type { CalibrationDialog } from "./calibration-dialog";
import type { ScaleSetupDialog } from "./scale-setup-dialog";
import { Theme } from "./theme";

type Tab = "boxes" | "components" | "assembly" | "journal";

export class SkuApp extends LitElement {
  /** Tabs of the dashboard; the chosen one lives in the URL hash, so a reload or a link keeps it. */
  private static readonly TABS: { id: Tab; label: string }[] = [
    { id: "boxes", label: "Склад" },
    { id: "components", label: "Компоненты" },
    { id: "assembly", label: "Сборка" },
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
    editingLayout: { state: true },
    placingBoxId: { state: true },
    selectedBoxId: { state: true },
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

      .tabs .live {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }

      /* A running assembly is visible from every tab: it has taken over the displays of the boxes */
      .assembly-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px 16px;
        margin-bottom: 20px;
        padding: 12px 14px;
        border: 2px solid var(--accent);
        background: var(--accent-soft);
      }

      .assembly-banner .buttons {
        display: flex;
        gap: 8px;
      }

      .assembly-banner strong {
        font-family: var(--mono);
      }

      .locate-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px 16px;
        margin-bottom: 20px;
        padding: 12px 14px;
        border: 2px solid var(--accent);
      }

      .locate-banner .where {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }

      .locate-banner .where button {
        padding: 3px 9px;
        font-family: var(--mono);
        font-size: 12.5px;
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
          padding: 8px 4px;
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
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 28px;
      }

      .metric {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
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

      .metric.bad .value {
        color: var(--tone-bad);
      }

      @media (max-width: 720px) {
        .summary {
          gap: 8px;
          margin-bottom: 22px;
        }

        .metric {
          padding: 10px 12px;
        }

        .metric .label {
          font-size: 10px;
          letter-spacing: 0.03em;
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

      .mini-row {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 190px));
        gap: 8px;
      }

      /* The stand map and the card of the chosen box side by side; on narrow screens the card goes below */
      .stands-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 600px);
        align-items: start;
        gap: 24px;
      }

      .box-detail {
        position: sticky;
        top: 78px;
        scroll-margin-top: 80px;
      }

      @media (max-width: 1100px) {
        .stands-layout {
          grid-template-columns: minmax(0, 1fr);
        }

        .box-detail {
          position: static;
          max-width: 640px;
        }
      }


      .layout-bar {
        min-height: 36px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 16px;
        margin-bottom: 16px;
        font-size: 13px;
      }

      .placing {
        position: sticky;
        top: 70px;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px 16px;
        margin-bottom: 20px;
        padding: 12px 14px;
        border-color: var(--accent);
      }

      .placing .buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      @media (max-width: 720px) {
        .placing {
          top: 120px;
        }
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
  /** The stands are being rearranged: box cards offer to move, rename or take a box off its stand. */
  declare editingLayout: boolean;
  /** Box the user is choosing a place on a stand for. */
  declare placingBoxId: string | null;
  /** Box whose full card is open under the stand map. */
  declare selectedBoxId: string | null;

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
    this.editingLayout = false;
    this.placingBoxId = null;
    this.selectedBoxId = null;
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
    this.addEventListener(DashboardEvents.SELECT_BOX, this.handleSelectBox);
    this.addEventListener(DashboardEvents.PLACE_BOX, this.handlePlaceBox);
    this.addEventListener(DashboardEvents.PLACE_AT, this.handlePlaceAt);
    this.addEventListener(DashboardEvents.RENAME_CLUSTER, this.handleRenameCluster);
    this.addEventListener(DashboardEvents.CANCEL_ASSEMBLY, this.handleCancelAssembly);
    this.addEventListener(DashboardEvents.LOCATE, this.handleLocate);
    window.addEventListener("hashchange", this.handleHashChange);
    window.addEventListener("keydown", this.handleKeydown);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("hashchange", this.handleHashChange);
    window.removeEventListener("keydown", this.handleKeydown);
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.removeEventListener(DashboardEvents.CALIBRATE, this.handleCalibrate);
    this.removeEventListener(DashboardEvents.SHOW_CALIBRATION, this.handleShowCalibration);
    this.removeEventListener(DashboardEvents.SCALE_SETUP, this.handleScaleSetup);
    this.removeEventListener(DashboardEvents.CANCEL_CALIBRATION, this.handleCancelCalibration);
    this.removeEventListener(DashboardEvents.RELEASE_COMPONENT, this.handleReleaseComponent);
    this.removeEventListener(DashboardEvents.SELECT_BOX, this.handleSelectBox);
    this.removeEventListener(DashboardEvents.PLACE_BOX, this.handlePlaceBox);
    this.removeEventListener(DashboardEvents.PLACE_AT, this.handlePlaceAt);
    this.removeEventListener(DashboardEvents.RENAME_CLUSTER, this.handleRenameCluster);
    this.removeEventListener(DashboardEvents.CANCEL_ASSEMBLY, this.handleCancelAssembly);
    this.removeEventListener(DashboardEvents.LOCATE, this.handleLocate);
  }

  /** Lights up the component's cells and opens the stand map on the first box holding it. */
  private readonly handleLocate = (event: Event): void => {
    const name = (event as CustomEvent<string>).detail;
    void this.run(async () => {
      const locate = await this.commands.startLocate(name);
      const first = [...locate.cells].sort((left, right) =>
        this.boxName(left.box_id).localeCompare(this.boxName(right.box_id), "ru", { numeric: true }),
      )[0];
      if (first) {
        this.selectedBoxId = first.box_id;
        location.hash = "boxes";
      }
    });
  };

  private boxName(boxId: string): string {
    return this.snapshot.boxNames.get(boxId) ?? boxId;
  }

  private readonly handleCancelAssembly = (event: Event): void => {
    this.cancelAssembly((event as CustomEvent<Assembly>).detail);
  };

  private cancelAssembly(assembly: Assembly): void {
    const title = this.format.assemblyTitle(assembly.name, assembly.kits);
    if (confirm(`Прервать сборку «${title}»? Дисплеи вернутся к обычному режиму, в журнал запишется, сколько взяли.`)) {
      void this.run(() => this.commands.cancelAssembly(assembly.id));
    }
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

  /** While rearranging, tapping a box on the map picks it up (tapping it again puts it back); otherwise it opens its card. */
  private readonly handleSelectBox = (event: Event): void => {
    const boxId = (event as CustomEvent<string>).detail;
    this.selectedBoxId = boxId;
    if (this.editingLayout || this.placingBoxId !== null) {
      this.actionError = null;
      this.placingBoxId = this.placingBoxId === boxId ? null : boxId;
      return;
    }
    // On a phone the card opens below the map, out of sight
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector(".box-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  /** The first box starts a stand right away; otherwise the stands show where the box can go. */
  private readonly handlePlaceBox = (event: Event): void => {
    const boxId = (event as CustomEvent<string>).detail;
    this.actionError = null;
    this.selectedBoxId = boxId;
    if (location.hash !== "#boxes") {
      location.hash = "boxes";
    }
    if (this.snapshot.clusters.length === 0) {
      void this.run(() => this.commands.placeBox(boxId, null));
    } else {
      this.placingBoxId = boxId;
    }
  };

  private readonly handlePlaceAt = (event: Event): void => {
    const request = (event as CustomEvent<PlaceAtRequest>).detail;
    const boxId = this.placingBoxId;
    if (boxId !== null) {
      void this.run(async () => {
        await this.commands.placeBox(boxId, request.clusterId, request.x, request.y);
        this.placingBoxId = null;
      });
    }
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.placingBoxId !== null) {
      this.placingBoxId = null;
    }
  };

  private unplaceBox(item: BoxOverview): void {
    const question =
      `Убрать бокс ${item.name} со стенда? Учёт по нему продолжится, а на дашборде он будет в «Не размещены».` +
      " Адреса остальных боксов стенда могут сдвинуться.";
    if (confirm(question)) {
      void this.run(async () => {
        await this.commands.unplaceBox(item.box.id);
        this.placingBoxId = null;
      });
    }
  }

  private renameBox(item: BoxOverview): void {
    const alias = prompt(`Название бокса ${item.name}, например, что в нём лежит. Пусто — без названия.`, item.box.alias ?? "");
    if (alias !== null) {
      void this.run(() => this.commands.renameBox(item.box.id, alias.trim() || null));
    }
  }

  private readonly handleRenameCluster = (event: Event): void => {
    const cluster = (event as CustomEvent<Cluster>).detail;
    const name = prompt("Название стенда", cluster.name)?.trim();
    if (name) {
      void this.run(() => this.commands.renameCluster(cluster.id, name));
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
      assembly: null,
      journal: null,
    };
    return html`
      <nav class="tabs">
        ${SkuApp.TABS.map(
          (tab) => html`<a href="#${tab.id}" aria-current=${tab.id === this.tab ? "page" : "false"}>
            ${tab.label}${counts[tab.id] ? html`<span class="badge">${counts[tab.id]}</span>` : nothing}
            ${tab.id === "assembly" && this.snapshot.activeAssembly
              ? html`<span class="live" title="Идёт сборка"></span>`
              : nothing}
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
      ${this.renderLocateBanner()} ${this.renderAssemblyBanner()}

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

  /** The component being looked for and where it lies; tapping a place opens that box. */
  private renderLocateBanner() {
    const locate = this.snapshot.locate;
    if (locate === null) {
      return nothing;
    }
    const cells = [...locate.cells].sort(
      (left, right) =>
        this.boxName(left.box_id).localeCompare(this.boxName(right.box_id), "ru", { numeric: true }) ||
        left.locker_id - right.locker_id,
    );
    return html`<div class="card locate-banner">
      <div>
        <b>🔍 Ищем «${locate.component_name}»</b>
        <span class="muted">
          ${cells.length
            ? `— дисплеи этих ячеек мигают ещё ${Math.ceil(locate.seconds_left)} с`
            : "— все ячейки с ним сейчас вынуты"}${locate.elsewhere ? ` · ещё ${locate.elsewhere} шт вне стенда` : ""}
        </span>
        ${cells.length
          ? html`<div class="where">
              ${cells.map(
                (cell) => html`<button
                  title="Открыть бокс"
                  @click=${() => {
                    this.selectedBoxId = cell.box_id;
                    location.hash = "boxes";
                  }}
                >
                  ${this.format.location(this.boxName(cell.box_id), cell.locker_id)} · ${cell.quantity} шт
                </button>`,
              )}
            </div>`
          : nothing}
      </div>
      <button @click=${() => void this.run(() => this.commands.stopLocate())}>Остановить</button>
    </div>`;
  }

  private renderAssemblyBanner() {
    const assembly = this.snapshot.activeAssembly;
    if (assembly === null || this.tab === "assembly") {
      return nothing;
    }
    const done = assembly.picks.filter((pick) => pick.remaining === 0).length;
    return html`<div class="card assembly-banner">
      <span>
        Идёт сборка «${this.format.assemblyTitle(assembly.name, assembly.kits)}»: ячеек готово
        <strong>${done} / ${assembly.picks.length}</strong>. Горят только дисплеи нужных ячеек.
      </span>
      <span class="buttons">
        <button class="primary" @click=${() => (location.hash = "assembly")}>Открыть</button>
        <button class="danger" @click=${() => this.cancelAssembly(assembly)}>Прервать</button>
      </span>
    </div>`;
  }

  private renderTab() {
    const snapshot = this.snapshot;
    switch (this.tab) {
      case "assembly":
        return html`<sku-assembly-tab
          .service=${this.commands}
          .specifications=${snapshot.specifications}
          .assemblies=${snapshot.assemblies}
          .activeAssembly=${snapshot.activeAssembly}
          .boxes=${snapshot.boxes}
          .boxNames=${snapshot.boxNames}
          .componentNames=${snapshot.componentNames}
        ></sku-assembly-tab>`;
      case "components":
        return html`
          <section>
            <sku-component-table
              .items=${snapshot.components}
              .locateName=${snapshot.locate?.component_name ?? null}
            ></sku-component-table>
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
          ${snapshot.boxes.length
            ? this.renderStands()
            : html`<section>
                <div class="card empty empty-state">
                  <div>Устройств нет. Зажмите кнопку подключения на боксе на 3 секунды и подключите его по Bluetooth.</div>
                  <button class="primary" @click=${this.openSetup}>Подключить бокс</button>
                </div>
              </section>`}
        `;
    }
  }

  /** Stands laid out as they stand, then the boxes that have no place yet. */
  private renderStands() {
    const snapshot = this.snapshot;
    const placing = snapshot.boxes.find((item) => item.box.id === this.placingBoxId) ?? null;
    const selected = this.selectedBox();
    return html`
      ${this.renderLayoutBar(placing)}
      <div class="stands-layout">
        <div class="stands">
          ${repeat(
            snapshot.clusters,
            (item) => item.cluster.id,
            (item) => html`<section>
              <sku-stand-view
                .overview=${item}
                ?editing=${this.editingLayout}
                .placing=${placing}
                .selectedBoxId=${selected?.box.id ?? null}
              ></sku-stand-view>
            </section>`,
          )}
          ${snapshot.unplaced.length
            ? html`<section>
                <div class="section-title">
                  <h2>Не размещены<span class="count">${snapshot.unplaced.length}</span></h2>
                </div>
                <div class="mini-row">
                  ${repeat(
                    snapshot.unplaced,
                    (item) => item.box.id,
                    (item) => html`<sku-box-mini
                      .overview=${item}
                      ?selected=${item.box.id === selected?.box.id}
                      ?moving=${item.box.id === this.placingBoxId}
                      ?arranging=${this.editingLayout || placing !== null}
                    ></sku-box-mini>`,
                  )}
                </div>
              </section>`
            : nothing}
        </div>
        ${selected
          ? html`<div class="box-detail">
              <sku-box-card .overview=${selected} ?moving=${selected.box.id === this.placingBoxId}></sku-box-card>
            </div>`
          : nothing}
      </div>
    `;
  }

  /** The chosen box, or the first one on the map so the page never opens empty. */
  private selectedBox(): BoxOverview | null {
    const snapshot = this.snapshot;
    const ordered = [...snapshot.clusters.flatMap((item) => item.boxes), ...snapshot.unplaced];
    return ordered.find((item) => item.box.id === this.selectedBoxId) ?? ordered[0] ?? null;
  }

  /** Above the map: how addresses read and the switch into rearranging; while rearranging, what to tap next and
   * what else can be done with the picked box. */
  private renderLayoutBar(placing: BoxOverview | null) {
    if (!this.editingLayout && placing === null) {
      return this.snapshot.clusters.length
        ? html`<div class="layout-bar">
            <span class="muted">
              Адрес бокса — столбец (A, B… слева направо) и ряд (1, 2… снизу вверх), как стоят боксы на стенде.
            </span>
            <button @click=${() => (this.editingLayout = true)}>Изменить расстановку</button>
          </div>`
        : nothing;
    }
    const alone =
      placing !== null &&
      placing.box.cluster_id !== null &&
      !this.snapshot.boxes.some((item) => item.box.cluster_id === placing.box.cluster_id && item !== placing);
    return html`<div class="card placing">
      <div>
        ${placing
          ? html`<b>Бокс ${placing.name}.</b>
              <span class="muted">
                Нажмите подсвеченное место «+ Сюда» рядом с боксом, к которому он пристыкован. Отмена — снова на бокс
                или Esc.
              </span>`
          : html`<b>Расстановка.</b>
              <span class="muted">Нажмите на бокс на схеме, чтобы переставить его, дать название или убрать со стенда.</span>`}
      </div>
      <div class="buttons">
        ${placing
          ? html`
              <button @click=${() => this.renameBox(placing)}>${placing.box.alias ? "Изменить название" : "Дать название"}</button>
              ${placing.box.cluster_id !== null
                ? html`<button class="danger" @click=${() => this.unplaceBox(placing)}>Убрать со стенда</button>`
                : nothing}
              ${alone ? nothing : html`<button @click=${() => this.handlePlaceAtNewStand(placing)}>На новый стенд</button>`}
              <button @click=${() => (this.placingBoxId = null)}>Отмена</button>
            `
          : nothing}
        ${this.editingLayout
          ? html`<button class="primary" @click=${this.finishLayout}>Готово</button>`
          : nothing}
      </div>
    </div>`;
  }

  private readonly finishLayout = (): void => {
    this.editingLayout = false;
    this.placingBoxId = null;
  };

  private handlePlaceAtNewStand(placing: BoxOverview): void {
    void this.run(async () => {
      await this.commands.placeBox(placing.box.id, null);
      this.placingBoxId = null;
    });
  }


  /** The state of the whole warehouse at a glance. */
  private renderSummary() {
    const boxes = this.snapshot.boxes;
    const lockers = this.lockers();
    const online = boxes.filter(({ box }) => box.online).length;
    const inserted = lockers.filter(({ locker }) => locker.nfc_flag).length;
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
      </div>
    `;
  }
}
