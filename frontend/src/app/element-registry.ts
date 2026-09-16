import { BoxCard } from "../components/box-card";
import { CalibrationDialog } from "../components/calibration-dialog";
import { CalibrationList } from "../components/calibration-list";
import { ComponentTable } from "../components/component-table";
import { EventLog } from "../components/event-log";
import { LockerTile } from "../components/locker-tile";
import { SkuApp } from "../components/sku-app";

export class ElementRegistry {
  private readonly elements: [string, CustomElementConstructor][] = [
    ["sku-app", SkuApp],
    ["sku-box-card", BoxCard],
    ["sku-locker-tile", LockerTile],
    ["sku-component-table", ComponentTable],
    ["sku-calibration-list", CalibrationList],
    ["sku-event-log", EventLog],
    ["sku-calibration-dialog", CalibrationDialog],
  ];

  register(): void {
    for (const [tag, element] of this.elements) {
      if (!customElements.get(tag)) {
        customElements.define(tag, element);
      }
    }
  }
}
