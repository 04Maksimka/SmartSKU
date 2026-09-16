import { LitElement, html } from "lit";

import type { Calibration } from "../api/types";
import { Formatter } from "../app/formatter";
import { Theme } from "./theme";

export class CalibrationList extends LitElement {
  static override properties = {
    calibrations: { attribute: false },
    boxNames: { attribute: false },
  };

  static override styles = [Theme.shared];

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
      <div class="section-title"><h2>Калибровки</h2></div>
      <div class="card table-wrap">
        ${this.calibrations.length
          ? html`<table>
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
        <td class="muted nowrap">${this.format.moment(item.created_at)}</td>
        <td>${item.name}</td>
        <td class="nowrap">${this.format.location(this.boxNames.get(item.box_id) ?? item.box_id, item.locker_id)}</td>
        <td class="num">${item.num_of_pieces}</td>
        <td class="num">${item.piece_weight === null ? "—" : this.format.pieceWeight(item.piece_weight)}</td>
        <td><span class="pill ${tone}">${label}</span></td>
      </tr>
    `;
  }
}
