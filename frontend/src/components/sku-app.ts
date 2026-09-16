import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { DashboardSnapshot, DashboardStore } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

export class SkuApp extends LitElement {
  static override properties = {
    store: { attribute: false },
    snapshot: { state: true },
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
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr));
        gap: 32px 16px;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `,
  ];

  declare store: DashboardStore;
  declare snapshot: DashboardSnapshot;

  private readonly format = new Formatter();
  private unsubscribe: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.store.subscribe((snapshot) => (this.snapshot = snapshot));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  protected override render() {
    const snapshot = this.snapshot;
    return html`
      <header>
        <h1>SmartSKU</h1>
        <div class="status muted">
          ${snapshot.error
            ? html`<span class="pill bad">○ нет связи с бэкендом</span>`
            : snapshot.updatedAt
              ? html`<span class="pill good">● онлайн</span>`
              : html`<span class="pill">загрузка…</span>`}
          ${snapshot.updatedAt ? html`<span>данные на ${this.format.time(snapshot.updatedAt)}</span>` : nothing}
          <span>обновление раз в ${this.store.refreshIntervalMs / 1000} с</span>
        </div>
      </header>

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

      <section>
        <sku-event-log .events=${snapshot.events} .boxNames=${snapshot.boxNames}></sku-event-log>
      </section>
    `;
  }
}
