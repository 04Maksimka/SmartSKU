import { BoxCard } from "../components/box-card";
import { BoxSetupDialog } from "../components/box-setup-dialog";
import { CalibrationDialog } from "../components/calibration-dialog";
import { CalibrationList } from "../components/calibration-list";
import { ComponentTable } from "../components/component-table";
import { EventLog } from "../components/event-log";
import { LockerTile } from "../components/locker-tile";
import { ProcedureChecklist } from "../components/procedure-checklist";
import { SkuApp } from "../components/sku-app";
import { ScaleSetupDialog } from "../components/scale-setup-dialog";
import { SegmentDisplay } from "../components/segment-display";
import { StandView } from "../components/stand-view";

export class ElementRegistry {
  private readonly elements: [string, CustomElementConstructor][] = [
    ["sku-app", SkuApp],
    ["sku-box-card", BoxCard],
    ["sku-stand-view", StandView],
    ["sku-locker-tile", LockerTile],
    ["sku-component-table", ComponentTable],
    ["sku-calibration-list", CalibrationList],
    ["sku-event-log", EventLog],
    ["sku-calibration-dialog", CalibrationDialog],
    ["sku-box-setup-dialog", BoxSetupDialog],
    ["sku-scale-setup-dialog", ScaleSetupDialog],
    ["sku-procedure-checklist", ProcedureChecklist],
    ["sku-segment-display", SegmentDisplay],
  ];

  register(): void {
    for (const [tag, element] of this.elements) {
      if (!customElements.get(tag)) {
        customElements.define(tag, element);
      }
    }
  }
}
