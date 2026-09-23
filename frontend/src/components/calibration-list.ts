import { LitElement, css, html } from "lit";

import type { Calibration } from "../api/types";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

export class CalibrationList extends LitElement {
  static override properties = {
    calibrations: { attribute: false },
    boxNames: { attribute: false },
  };

  static override styles = [
    Theme.shared,
    css`
      td.name {
        overflow-wrap: break-word;
      }

      /* Phone card: status and time, the component, then where and how many pieces */
      @media (max-width: 720px) {
        td.status {
          grid-column: 1;
          grid-row: 1;
        }

        td.created {
          grid-column: 2;
          grid-row: 1;
        }

        td.name {
          grid-column: 1 / -1;
        }

        td.where {
          grid-column: 1;
          font-size: 12.5px;
          color: var(--muted);
        }

        td.pieces {
          grid-column: 2;
          font-size: 12.5px;
        }

        td.piece {
          grid-column: 2;
          font-size: 12.5px;
        }
      }
    `,
  ];

  declare calibrations: Calibration[];
  declare boxNames: Map<string, string>;

  private readonly format = new Formatter();

  constructor() {
    super();
    this.calibrations = [];
    this.boxNames = new Map();
  }

  protected override render() {
    return html`
      <div class="section-title"><h2>Калибровки<span class="count">${this.calibrations.length}</span></h2></div>
      <div class="card table-wrap">
        ${this.calibrations.length
          ? html`<table class="cards">
              <thead>
                <tr>
                  <th>Создана</th>
                  <th>Компонент</th>
                  <th>Где</th>
                  <th class="num">Штук</th>
                  <th class="num">1 штука</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                ${this.calibrations.map((item) => this.renderRow(item))}
              </tbody>
            </table>`
          : html`<div class="empty">Калибровок ещё не было</div>`}
      </div>
    `;
  }

  private renderRow(item: Calibration) {
    const [label, tone] = this.format.calibrationLabel(item.status);
    return html`
      <tr>
        <td class="created muted nowrap end">${this.format.moment(item.created_at)}</td>
        <td class="name">${item.name}</td>
        <td class="where nowrap">${this.format.location(this.boxNames.get(item.box_id) ?? item.box_id, item.locker_id)}</td>
        <td class="pieces num end" data-label="штук">${item.num_of_pieces}</td>
        <td class="piece num end ${item.piece_weight === null ? "phone-hidden" : ""}" data-label="1 шт">
          ${item.piece_weight === null ? "—" : this.format.pieceWeight(item.piece_weight)}
        </td>
        <td class="status"><span class="pill ${tone}">${label}</span></td>
      </tr>
    `;
  }
}
