import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Assembly, Specification } from "../api/types";
import { CommandService } from "../app/command-service";
import type { BoxOverview } from "../app/dashboard-store";
import { Formatter } from "../app/formatter";
import type { AssemblyDialog } from "./assembly-dialog";
import type { SpecificationDialog } from "./specification-dialog";
import { Theme } from "./theme";

/** The "Сборка" tab: the running assembly, the specifications to assemble by, and past assemblies. */
export class AssemblyTab extends LitElement {
  /** A finished assembly is announced at the top of the tab for this long. */
  private static readonly RECENT_MS = 2 * 60 * 1000;

  static override properties = {
    service: { attribute: false },
    specifications: { attribute: false },
    assemblies: { attribute: false },
    activeAssembly: { attribute: false },
    boxes: { attribute: false },
    boxNames: { attribute: false },
    componentNames: { attribute: false },
    error: { state: true },
  };

  static override styles = [
    Theme.shared,
    css`
      section + section {
        margin-top: 32px;
      }

      .specs {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }

      .spec {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
      }

      .spec h3 {
        margin: 0;
        font-size: 16px;
        overflow-wrap: anywhere;
      }

      .spec ul {
        flex: 1;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13.5px;
      }

      .spec li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .spec li .qty {
        font-family: var(--mono);
        font-weight: 600;
        white-space: nowrap;
      }

      .spec .buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .spec .buttons .primary {
        flex: 1;
      }

      .announce {
        margin-bottom: 20px;
        padding: 12px 14px;
        border-radius: var(--r-sm, 9px);
        font-weight: 600;
        background: var(--tone-good-bg);
        color: var(--tone-good);
      }

      .error {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: var(--r-sm, 9px);
        background: var(--tone-bad-bg);
        color: var(--tone-bad);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      /* Phone card: the product and status on top, then the times and the count */
      @media (max-width: 720px) {
        td.product {
          grid-column: 1;
          grid-row: 1;
        }

        td.status {
          grid-column: 2;
          grid-row: 1;
        }

        td.started,
        td.finished {
          grid-column: 1;
          font-size: 12.5px;
        }

        td.taken {
          grid-column: 2;
        }
      }
    `,
  ];

  declare service: CommandService;
  declare specifications: Specification[];
  declare assemblies: Assembly[];
  declare activeAssembly: Assembly | null;
  declare boxes: BoxOverview[];
  declare boxNames: Map<string, string>;
  declare componentNames: string[];
  declare error: string | null;

  private readonly format = new Formatter();

  constructor() {
    super();
    this.specifications = [];
    this.assemblies = [];
    this.activeAssembly = null;
    this.boxes = [];
    this.boxNames = new Map();
    this.componentNames = [];
    this.error = null;
  }

  protected override render() {
    return html`
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      ${this.renderAnnouncement()}
      ${this.activeAssembly
        ? html`<section>
            <sku-assembly-progress .assembly=${this.activeAssembly} .boxes=${this.boxes}></sku-assembly-progress>
          </section>`
        : nothing}
      <section>${this.renderSpecifications()}</section>
      ${this.assemblies.length ? html`<section>${this.renderHistory()}</section>` : nothing}

      <sku-specification-dialog
        .service=${this.service}
        .componentNames=${this.componentNames}
      ></sku-specification-dialog>
      <sku-assembly-dialog
        .service=${this.service}
        .boxNames=${this.boxNames}
        .activeAssembly=${this.activeAssembly}
      ></sku-assembly-dialog>
    `;
  }

  /** The assembly that has just ended by itself: every cell holds what it should. */
  private renderAnnouncement() {
    const latest = this.assemblies[0];
    if (this.activeAssembly || latest?.status !== "completed" || latest.finished_at === null) {
      return nothing;
    }
    if (Date.now() - this.format.date(latest.finished_at).getTime() > AssemblyTab.RECENT_MS) {
      return nothing;
    }
    return html`<div class="announce">
      ✓ Сборка «${this.format.assemblyTitle(latest.name, latest.kits)}» завершена: все компоненты взяты, дисплеи снова
      показывают количество.
    </div>`;
  }

  private renderSpecifications() {
    return html`
      <div class="section-title">
        <h2>Спецификации<span class="count">${this.specifications.length}</span></h2>
        <button class="primary" @click=${() => this.editSpecification(null)}>+ Новая спецификация</button>
      </div>
      ${this.specifications.length
        ? html`<div class="specs">
            ${repeat(
              this.specifications,
              (item) => item.id,
              (item) => this.renderSpecification(item),
            )}
          </div>`
        : html`<div class="card empty empty-state">
            <div>
              Спецификация — это изделие и сколько каких компонентов на него уходит, например стол: 20 шурупов, 10 гаек.
              По ней система проверит склад и подсветит нужные ячейки.
            </div>
            <button class="primary" @click=${() => this.editSpecification(null)}>Создать спецификацию</button>
          </div>`}
    `;
  }

  private renderSpecification(specification: Specification) {
    const running = this.activeAssembly?.specification_id === specification.id;
    return html`<div class="card spec">
      <h3>${specification.name}</h3>
      <ul>
        ${specification.items.map(
          (item) => html`<li><span>${item.component_name}</span><span class="qty">${item.quantity} шт</span></li>`,
        )}
      </ul>
      <div class="buttons">
        <button
          class="primary"
          ?disabled=${running}
          title=${this.activeAssembly ? "Идёт другая сборка" : "Проверить склад и подсветить ячейки"}
          @click=${() => this.assemblyDialog()?.open(specification)}
        >
          ${running ? "Собирается…" : "Собрать"}
        </button>
        <button @click=${() => this.editSpecification(specification)}>Изменить</button>
        <button class="danger" @click=${() => void this.deleteSpecification(specification)}>Удалить</button>
      </div>
    </div>`;
  }

  private renderHistory() {
    return html`
      <div class="section-title">
        <h2>История сборок<span class="count">${this.assemblies.length}</span></h2>
      </div>
      <div class="card table-wrap">
        <table class="cards">
          <thead>
            <tr>
              <th>Изделие</th>
              <th>Статус</th>
              <th>Начало</th>
              <th>Конец</th>
              <th class="num">Взято</th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              this.assemblies,
              (item) => item.id,
              (item) => this.renderAssembly(item),
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderAssembly(assembly: Assembly) {
    const [label, tone] = this.format.assemblyLabel(assembly.status);
    const required = assembly.picks.reduce((sum, pick) => sum + pick.quantity, 0);
    const taken = assembly.picks.reduce((sum, pick) => sum + pick.taken, 0);
    return html`<tr>
      <td class="product">
        ${this.format.assemblyTitle(assembly.name, assembly.kits)} <span class="muted mono">№${assembly.id}</span>
      </td>
      <td class="status"><span class="pill ${tone}">${label}</span></td>
      <td class="started muted nowrap" data-label="начало">${this.format.moment(assembly.started_at)}</td>
      <td class="finished muted nowrap" data-label="конец">
        ${assembly.finished_at ? this.format.moment(assembly.finished_at) : "—"}
      </td>
      <td class="taken num end mono">${taken} / ${required} шт</td>
    </tr>`;
  }

  private async deleteSpecification(specification: Specification): Promise<void> {
    if (this.service.readOnly) {
      this.error = CommandService.READ_ONLY_MESSAGE;
      return;
    }
    if (!confirm(`Удалить спецификацию «${specification.name}»? История сборок по ней останется.`)) {
      return;
    }
    this.error = null;
    try {
      await this.service.deleteSpecification(specification.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private editSpecification(specification: Specification | null): void {
    if (this.service.readOnly) {
      this.error = CommandService.READ_ONLY_MESSAGE;
      return;
    }
    this.error = null;
    this.specificationDialog()?.open(specification);
  }

  private specificationDialog(): SpecificationDialog | null {
    return this.renderRoot.querySelector("sku-specification-dialog");
  }

  private assemblyDialog(): AssemblyDialog | null {
    return this.renderRoot.querySelector("sku-assembly-dialog");
  }
}
