import { LitElement, css, html, nothing } from "lit";

import type {
  BoxInfoMessage,
  BoxMessage,
  StatusMessage,
  WifiAuth,
  WifiNetwork,
} from "../api/box-setup-types";
import { BleBoxLink } from "../app/ble-box-link";
import type { CommandService } from "../app/command-service";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

type Step = "intro" | "configure" | "progress";

/**
 * Connecting a box from the dashboard: the browser talks to the box over Bluetooth, so the computer stays on its
 * own Wi-Fi. The box reports its hardware and the networks it sees, gets Wi-Fi and broker settings, and reports
 * how its connection goes until the backend registers it.
 */
export class BoxSetupDialog extends LitElement {
  static override properties = {
    service: { attribute: false },
    step: { state: true },
    busy: { state: true },
    error: { state: true },
    info: { state: true },
    networks: { state: true },
    scanning: { state: true },
    ssid: { state: true },
    auth: { state: true },
    username: { state: true },
    password: { state: true },
    host: { state: true },
    port: { state: true },
    status: { state: true },
    linkLost: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      dialog {
        width: min(760px, calc(100vw - 32px));
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

      h3 {
        margin: 0;
        font-size: 15px;
      }

      ol {
        margin: 0;
        padding-left: 20px;
        line-height: 1.6;
      }

      .columns {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
        gap: 16px;
      }

      .panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
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
        overflow-wrap: anywhere;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      th,
      td {
        padding: 4px 6px;
        text-align: left;
        border-bottom: 1px solid var(--border);
      }

      th {
        color: var(--muted);
        font-weight: 500;
      }

      .ok {
        color: var(--tone-good);
      }

      .missing {
        color: var(--tone-bad);
      }

      .networks {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 220px;
        overflow-y: auto;
      }

      .network {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        text-align: left;
        font-weight: 400;
        padding: 7px 10px;
      }

      .network.selected {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent);
      }

      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: var(--muted);
      }

      label input,
      label select {
        width: 100%;
      }

      .row {
        display: grid;
        grid-template-columns: 1fr 110px;
        gap: 8px;
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

      .steps {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .steps li {
        display: flex;
        gap: 8px;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }

      .head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
    `,
  ];

  private static readonly HOST_STORAGE_KEY = "smartsku.setup.brokerHost";
  private static readonly LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  private static readonly PROGRESS: { state: StatusMessage["state"]; label: string }[] = [
    { state: "wifi_connecting", label: "Подключение к Wi-Fi" },
    { state: "server_connecting", label: "Подключение к серверу" },
    { state: "registering", label: "Регистрация бокса" },
    { state: "registered", label: "Бокс на складе" },
  ];

  declare service: CommandService;
  declare step: Step;
  declare busy: boolean;
  declare error: string | null;
  declare info: BoxInfoMessage | null;
  declare networks: WifiNetwork[] | null;
  declare scanning: boolean;
  declare ssid: string;
  declare auth: WifiAuth;
  declare username: string;
  declare password: string;
  declare host: string;
  declare port: string;
  declare status: StatusMessage | null;
  declare linkLost: boolean;

  private readonly link = new BleBoxLink();
  private readonly format = new Formatter();
  private readonly subscriptions: (() => void)[] = [];

  constructor() {
    super();
    this.reset();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.subscriptions.push(
      this.link.onMessage(this.handleMessage),
      this.link.onDisconnect(() => (this.linkLost = true)),
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    this.link.disconnect();
  }

  open(): void {
    this.reset();
    this.dialog()?.showModal();
  }

  private reset(): void {
    this.step = "intro";
    this.busy = false;
    this.error = null;
    this.info = null;
    this.networks = null;
    this.scanning = false;
    this.ssid = "";
    this.auth = "password";
    this.username = "";
    this.password = "";
    this.host = "";
    this.port = "1883";
    this.status = null;
    this.linkLost = false;
  }

  protected override render() {
    return html`
      <dialog @close=${this.handleClose}>
        <div class="body">
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
          ${this.renderStep()}
        </div>
      </dialog>
    `;
  }

  private renderStep() {
    switch (this.step) {
      case "intro":
        return this.renderIntro();
      case "configure":
        return this.renderConfigure();
      case "progress":
        return this.renderProgress();
    }
  }

  private renderIntro() {
    const supported = BleBoxLink.isSupported();
    return html`
      <h2>Подключить бокс</h2>
      <ol>
        <li>Включите бокс и зажмите кнопку <b>BOOT</b> на плате на 3 секунды — встроенный светодиод начнёт коротко
          вспыхивать раз в секунду. Новый бокс без настроек сети включает этот режим сам.</li>
        <li>Нажмите «Найти бокс» и выберите <span class="mono">${BleBoxLink.NAME_PREFIX}…</span> в окне браузера.</li>
        <li>Выберите Wi-Fi сеть для бокса — компьютер остаётся в своей сети.</li>
      </ol>
      <div class="note">Не держите BOOT в момент включения питания: плата уйдёт в режим прошивки.
        Режим подключения сам выключится через 5 минут без действий.</div>
      ${supported
        ? nothing
        : html`<div class="note warn">Этот браузер не умеет работать с Bluetooth. Откройте дашборд в Google Chrome
            или Microsoft Edge. Bluetooth доступен только на <span class="mono">localhost</span> или по HTTPS.</div>`}
      <div class="actions">
        <button @click=${this.close}>Отмена</button>
        <button class="primary" ?disabled=${!supported || this.busy} @click=${() => void this.chooseBox()}>
          ${this.busy ? "Подключение…" : "Найти бокс"}
        </button>
      </div>
    `;
  }

  private renderConfigure() {
    return html`
      <div class="head">
        <h2>Бокс ${this.link.deviceName}</h2>
        ${this.linkLost
          ? html`<button @click=${() => void this.reconnect()}>Переподключиться</button>`
          : html`<span class="pill good">● Bluetooth</span>`}
      </div>
      ${this.linkLost ? this.renderLinkLost() : nothing}
      <div class="columns">
        <div class="panel">${this.renderInfo()}</div>
        <form class="panel" @submit=${this.handleSubmit}>${this.renderNetworkForm()}</form>
      </div>
    `;
  }

  private renderLinkLost() {
    return html`<div class="note warn">Связь с боксом по Bluetooth потеряна. Если режим подключения закончился, снова
      зажмите BOOT на 3 секунды и нажмите «Переподключиться».</div>`;
  }

  private renderInfo() {
    const info = this.info;
    if (info === null) {
      return html`<h3>Сведения о боксе</h3><div class="muted">Запрашиваю…</div>`;
    }
    const working = info.lockers.filter((locker) => locker.load_cell && locker.nfc_reader).length;
    return html`
      <h3>Сведения о боксе</h3>
      <dl>
        <dt>Аппаратный id</dt>
        <dd class="mono">${info.hardware_id}</dd>
        <dt>Прошивка</dt>
        <dd>${info.firmware}</dd>
        <dt>Wi-Fi</dt>
        <dd>
          ${info.wifi.ssid || "не настроен"}
          ${info.wifi.ssid ? (info.wifi.connected ? html`<span class="ok">● ${info.wifi.ip}</span>` : "○ нет связи") : nothing}
        </dd>
        <dt>Сервер</dt>
        <dd>
          ${info.server.host ? `${info.server.host}:${info.server.port}` : "не настроен"}
          ${info.server.host ? (info.server.connected ? html`<span class="ok">● на связи</span>` : "○ нет связи") : nothing}
        </dd>
        <dt>box_id</dt>
        <dd class="mono">${info.box_id || "—"}</dd>
      </dl>
      <h3>Ячейки: работают ${working} из ${info.lockers.length}</h3>
      <table>
        <thead>
          <tr><th>Слот</th><th>Весы</th><th>NFC</th><th>Дисплей</th><th>Слот</th><th>Ячейка</th></tr>
        </thead>
        <tbody>
          ${info.lockers.map(
            (locker) => html`<tr>
              <td>${this.format.slot(locker.locker_id)}</td>
              <td>${this.mark(locker.load_cell)}</td>
              <td>${this.mark(locker.nfc_reader)}</td>
              <td>${locker.display ? "есть" : "—"}</td>
              <td>${locker.slot_ready ? "настроен" : html`<span class="missing">не настроен</span>`}</td>
              <td class="mono">${locker.cell || "—"}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    `;
  }

  private renderNetworkForm() {
    const needsPassword = this.auth !== "open";
    return html`
      <div class="head">
        <h3>Сеть для бокса</h3>
        <button type="button" ?disabled=${this.scanning || this.linkLost} @click=${() => void this.scan()}>
          ${this.scanning ? "Поиск…" : "Обновить"}
        </button>
      </div>
      ${this.renderNetworks()}
      <label>
        Имя сети
        <input .value=${this.ssid} required @input=${(e: Event) => (this.ssid = this.inputValue(e))} />
      </label>
      <label>
        Защита
        <select .value=${this.auth} @change=${(e: Event) => (this.auth = this.inputValue(e) as WifiAuth)}>
          <option value="password">Пароль</option>
          <option value="enterprise">Логин и пароль (WPA2 Enterprise)</option>
          <option value="open">Открытая сеть</option>
        </select>
      </label>
      ${this.auth === "enterprise"
        ? html`<label>
            Логин
            <input .value=${this.username} required autocomplete="username"
              @input=${(e: Event) => (this.username = this.inputValue(e))} />
          </label>`
        : nothing}
      ${needsPassword
        ? html`<label>
            Пароль
            <input type="password" .value=${this.password} required autocomplete="current-password"
              minlength=${this.auth === "password" ? 8 : 1}
              @input=${(e: Event) => (this.password = this.inputValue(e))} />
          </label>`
        : nothing}
      <div class="row">
        <label>
          Адрес сервера для бокса
          <input .value=${this.host} required placeholder="192.168.1.10 или имя.local"
            @input=${(e: Event) => (this.host = this.inputValue(e))} />
        </label>
        <label>
          Порт MQTT
          <input type="number" min="1" max="65535" .value=${this.port} required
            @input=${(e: Event) => (this.port = this.inputValue(e))} />
        </label>
      </div>
      <div class="muted" style="font-size: 12px">
        IP этого компьютера в сети бокса (на Mac: <span class="mono">ipconfig getifaddr en0</span>) или его имя
        с <span class="mono">.local</span> (<span class="mono">scutil --get LocalHostName</span>). Имя не меняется
        вместе с IP, но в некоторых корпоративных сетях не находится.
      </div>
      <div class="actions">
        <button type="button" @click=${this.close}>Отмена</button>
        <button class="primary" type="submit" ?disabled=${this.busy || this.linkLost || this.info === null}>
          Подключить
        </button>
      </div>
    `;
  }

  private renderNetworks() {
    if (this.networks === null) {
      return html`<div class="muted">${this.scanning ? "Бокс ищет сети, это до 20 секунд…" : "Сети не загружены"}</div>`;
    }
    if (!this.networks.length) {
      return html`<div class="muted">Бокс не видит сетей. ESP32 работает только на 2.4 ГГц.</div>`;
    }
    return html`<div class="networks">
      ${this.networks.map(
        (network) => html`<button
          type="button"
          class="network ${network.ssid === this.ssid ? "selected" : ""}"
          @click=${() => this.pickNetwork(network)}
        >
          <span>${network.ssid}</span>
          <span class="muted">${this.authLabel(network.auth)} · ${this.signalLabel(network.rssi)}</span>
        </button>`,
      )}
    </div>`;
  }

  private renderProgress() {
    const status = this.status;
    const current = status ? this.progressIndex(status.state) : 0;
    const done = status?.state === "registered";
    return html`
      <h2>Подключение бокса ${this.link.deviceName}</h2>
      <ul class="steps">
        ${BoxSetupDialog.PROGRESS.map((item, index) => {
          const mark = index < current || done ? "✓" : index === current ? (this.failed() ? "✗" : "…") : "○";
          return html`<li><span>${mark}</span><span>${item.label}</span></li>`;
        })}
      </ul>
      ${this.renderStatusNote()}
      ${this.linkLost && !done ? this.renderLinkLost() : nothing}
      <div class="actions">
        ${done
          ? html`<button class="primary" @click=${this.close}>Готово</button>`
          : html`
              <button @click=${this.close}>Закрыть</button>
              <button ?disabled=${this.linkLost} @click=${() => (this.step = "configure")}>Изменить настройки</button>
              ${this.linkLost ? html`<button @click=${() => void this.reconnect()}>Переподключиться</button>` : nothing}
            `}
      </div>
    `;
  }

  private renderStatusNote() {
    const status = this.status;
    if (status === null) {
      return html`<div class="note">Настройки отправлены, бокс переподключается…</div>`;
    }
    switch (status.state) {
      case "wifi_failed":
        return html`<div class="error">
          Бокс не подключился к Wi-Fi «${this.ssid}»: ${this.wifiReason(status)}. Он продолжает пытаться — проверьте
          данные и нажмите «Изменить настройки».
        </div>`;
      case "server_failed":
        return html`<div class="error">
          Wi-Fi есть (IP бокса ${status.ip}), но сервер ${status.host}:${this.port} не отвечает. Проверьте адрес
          компьютера, что контейнеры запущены и что бокс с компьютером в одной сети.
        </div>`;
      case "registering":
        return html`<div class="note">Бокс на связи и ждёт box_id от бэкенда.</div>`;
      case "registered":
        return html`<div class="note good">
          Бокс зарегистрирован (box_id <span class="mono">${status.box_id}</span>) и появился на складе. Для новых
          ячеек установите ноль на их карточках.
        </div>`;
      default:
        return html`<div class="note">Бокс подключается…</div>`;
    }
  }

  private readonly handleMessage = (message: BoxMessage): void => {
    switch (message.type) {
      case "info":
        this.info = message;
        this.prefillFromInfo(message);
        break;
      case "networks":
        this.networks = message.items;
        this.scanning = false;
        if (!this.ssid && this.info?.wifi.ssid) {
          this.ssid = this.info.wifi.ssid;
        }
        this.syncAuthWithScan();
        break;
      case "status":
        this.status = message;
        if (message.state === "registered") {
          void this.service.refresh();
        }
        break;
      case "error":
        this.error = `Бокс ответил: ${message.message}`;
        break;
    }
  };

  private async chooseBox(): Promise<void> {
    this.busy = true;
    this.error = null;
    try {
      await this.link.choose();
      this.linkLost = false;
      this.step = "configure";
      await this.prefillServer();
      await this.link.send({ op: "info" });
      await this.scan();
    } catch (error) {
      // Closing the browser's chooser is not an error worth showing.
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        this.error = this.describe(error);
      }
    } finally {
      this.busy = false;
    }
  }

  private async reconnect(): Promise<void> {
    this.error = null;
    try {
      await this.link.connect();
      this.linkLost = false;
      await this.link.send({ op: "info" });
    } catch (error) {
      this.error = this.describe(error);
    }
  }

  private async scan(): Promise<void> {
    this.scanning = true;
    try {
      await this.link.send({ op: "scan" });
    } catch (error) {
      this.scanning = false;
      this.error = this.describe(error);
    }
  }

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    void this.submit();
  };

  private async submit(): Promise<void> {
    const info = this.info;
    const port = Number(this.port);
    if (info === null || !Number.isInteger(port) || port < 1 || port > 65535) {
      this.error = "Проверьте порт MQTT";
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      // The backend must expect this box before it asks for a box_id.
      await this.service.claimBox(info.hardware_id);
      await this.link.send({
        op: "connect",
        ssid: this.ssid.trim(),
        username: this.auth === "enterprise" ? this.username.trim() : "",
        password: this.auth === "open" ? "" : this.password,
        host: this.host.trim(),
        port,
      });
      this.rememberHost(this.host.trim());
      this.status = null;
      this.step = "progress";
    } catch (error) {
      this.error = this.describe(error);
    } finally {
      this.busy = false;
    }
  }

  private prefillFromInfo(info: BoxInfoMessage): void {
    if (!this.ssid && info.wifi.ssid) {
      this.ssid = info.wifi.ssid;
      this.auth = info.wifi.username ? "enterprise" : "password";
      this.username = info.wifi.username;
    }
  }

  /** Suggests the broker address: backend config, then the host the dashboard is opened with, then the last one. */
  private async prefillServer(): Promise<void> {
    let configured = "";
    try {
      const settings = await this.service.onboardingSettings();
      configured = settings.broker_host;
      this.port = String(settings.broker_port);
    } catch {
      // Older backend or no connection: the user can still type the address.
    }
    const pageHost = BoxSetupDialog.LOCAL_HOSTS.has(location.hostname) ? "" : location.hostname;
    this.host = configured || pageHost || this.rememberedHost();
  }

  private pickNetwork(network: WifiNetwork): void {
    if (network.ssid !== this.ssid) {
      this.password = "";
    }
    this.ssid = network.ssid;
    this.auth = network.auth;
  }

  private syncAuthWithScan(): void {
    const match = this.networks?.find((network) => network.ssid === this.ssid);
    if (match) {
      this.auth = match.auth;
    }
  }

  private progressIndex(state: StatusMessage["state"]): number {
    const normalized = state === "wifi_failed" ? "wifi_connecting" : state === "server_failed" ? "server_connecting" : state;
    return BoxSetupDialog.PROGRESS.findIndex((item) => item.state === normalized);
  }

  private failed(): boolean {
    return this.status?.state === "wifi_failed" || this.status?.state === "server_failed";
  }

  private wifiReason(status: StatusMessage): string {
    const byCode: Record<number, string> = {
      201: "сеть не найдена (ESP32 видит только 2.4 ГГц)",
      202: "не подошёл логин или пароль",
      15: "не подошёл пароль",
      204: "не подошёл пароль",
      23: "не подошёл логин или пароль",
    };
    return (status.reason !== undefined && byCode[status.reason]) || status.message || "неизвестная ошибка";
  }

  private mark(ok: boolean) {
    return ok ? html`<span class="ok">✓</span>` : html`<span class="missing">✗</span>`;
  }

  private authLabel(auth: WifiAuth): string {
    return auth === "open" ? "открытая" : auth === "enterprise" ? "логин" : "пароль";
  }

  private signalLabel(rssi: number): string {
    return rssi >= -60 ? "сильный" : rssi >= -75 ? "средний" : "слабый";
  }

  private rememberedHost(): string {
    try {
      return localStorage.getItem(BoxSetupDialog.HOST_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private rememberHost(host: string): void {
    try {
      localStorage.setItem(BoxSetupDialog.HOST_STORAGE_KEY, host);
    } catch {
      // Storage may be unavailable; the address is only a convenience.
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private readonly close = (): void => {
    this.dialog()?.close();
  };

  private readonly handleClose = (): void => {
    this.link.disconnect();
    this.reset();
  };

  private dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }
}
