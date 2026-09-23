import type { CalibrationStatus, InventoryEventType } from "../api/types";

export type Tone = "neutral" | "good" | "bad" | "warn" | "info";

export class Formatter {
  private readonly timeFormat = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  private readonly dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" });

  private readonly eventLabels: Record<InventoryEventType, [string, Tone]> = {
    cell_removed: ["Ячейка извлечена", "warn"],
    cell_inserted: ["Ячейка вставлена", "info"],
    quantity_changed: ["Изменение количества", "neutral"],
    calibrated: ["Калибровка", "good"],
    calibration_failed: ["Калибровка не удалась", "bad"],
    slot_zeroed: ["Ноль слота", "info"],
    slot_scaled: ["Слот настроен гирей", "info"],
    cell_tared: ["Ячейка взвешена пустой", "info"],
    scale_failed: ["Настройка весов не удалась", "bad"],
  };

  private readonly calibrationLabels: Record<CalibrationStatus, [string, Tone]> = {
    pending: ["Ожидает", "warn"],
    completed: ["Завершена", "good"],
    cancelled: ["Отменена", "neutral"],
  };

  /** Backend timestamps are UTC; a value without an offset is treated as UTC too. */
  date(value: string): Date {
    return new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value}Z`);
  }

  time(value: string | Date): string {
    return this.timeFormat.format(typeof value === "string" ? this.date(value) : value);
  }

  /** Time for today, date plus time for older moments. */
  moment(value: string): string {
    const date = this.date(value);
    const time = this.timeFormat.format(date);
    return date.toDateString() === new Date().toDateString() ? time : `${this.dateFormat.format(date)} ${time}`;
  }

  /** Weight is in grams: every load cell is set up with the reference weight. */
  weight(value: number): string {
    return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} г`;
  }

  pieceWeight(value: number): string {
    return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} г`;
  }

  pieces(value: number | null): string {
    return value === null ? "—" : `${value} шт`;
  }

  delta(value: number): string {
    return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
  }

  /** Slot number printed on the box: locker_id counts from 0, the labels from 1. */
  slot(lockerId: number): number {
    return lockerId + 1;
  }

  location(boxName: string, lockerId: number): string {
    return `${boxName} · слот ${this.slot(lockerId)}`;
  }

  eventLabel(type: InventoryEventType): [string, Tone] {
    return this.eventLabels[type];
  }

  eventTypes(): [InventoryEventType, string][] {
    return Object.entries(this.eventLabels).map(([type, [label]]) => [type as InventoryEventType, label]);
  }

  calibrationLabel(status: CalibrationStatus): [string, Tone] {
    return this.calibrationLabels[status];
  }
}
