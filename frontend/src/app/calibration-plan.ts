import type { CalibrationStep } from "../api/types";

export type StepState = "done" | "current" | "pending" | "failed";

export interface ChecklistItem {
  title: string;
  hint: string;
  /** What the slot display shows while the box waits for this step. */
  display: string | null;
  state: StepState;
}

/** Where a calibration is: from the button press to the box's final report. */
export type CalibrationProgressState =
  | { kind: "sent" }
  | { kind: "running"; step: CalibrationStep }
  | { kind: "done" }
  | { kind: "failed"; step: CalibrationStep | null };

type StepKey = "start" | CalibrationStep | "done";

interface StepText {
  key: StepKey;
  title: string;
  hint: string;
  display: string | null;
}

/**
 * The checklist of a calibration. The box walks through the steps by itself (firmware Locker.h) and reports the one
 * it waits for; the plan turns that into done / current / pending items. The box may go back a step (a cell inserted
 * empty is sent back out), the list follows.
 */
export class CalibrationPlan {
  private readonly steps: StepText[];

  constructor(pieces: number, name: string) {
    const portion = `${pieces} шт.${name ? ` «${name}»` : ""}`;
    this.steps = [
      {
        key: "start",
        title: "Укажите компонент и калибровочное количество",
        hint: "",
        display: null,
      },
      {
        key: "remove_cell",
        title: `Выньте ячейку и насыпьте ровно ${portion}`,
        hint: "Если в ячейке уже что-то лежит, высыпьте и отсчитайте порцию заново.",
        display: "OUt",
      },
      {
        key: "insert_filled",
        title: `Вставьте ячейку с ${portion}`,
        hint: "Считайте точно: по этой порции бокс посчитает вес одной штуки.",
        display: "In",
      },
      {
        key: "measure_pieces",
        title: "Не трогайте ячейку — бокс считает вес одной штуки",
        hint: "1–2 секунды, потом вес штуки запишется в метку.",
        display: "HOLd",
      },
      {
        key: "done",
        title: "Готово",
        hint: "Вес штуки записан в NFC-метку, бокс считает количество.",
        display: "donE",
      },
    ];
  }

  get length(): number {
    return this.steps.length;
  }

  /** 1-based number of the step the box waits for, for a short "шаг 3 из 5". */
  position(step: CalibrationStep): number {
    return this.indexOf(step) + 1;
  }

  title(step: CalibrationStep): string {
    return this.steps[this.indexOf(step)].title;
  }

  items(progress: CalibrationProgressState): ChecklistItem[] {
    const current = this.currentIndex(progress);
    return this.steps.map((step, index) => ({
      title: step.title,
      hint: step.hint,
      display: step.display,
      state: this.state(index, current, progress),
    }));
  }

  private currentIndex(progress: CalibrationProgressState): number {
    switch (progress.kind) {
      case "sent":
        return 1;
      case "running":
        return this.indexOf(progress.step);
      case "done":
        return this.steps.length;
      case "failed":
        return progress.step === null ? 1 : this.indexOf(progress.step);
    }
  }

  private state(index: number, current: number, progress: CalibrationProgressState): StepState {
    if (index < current || progress.kind === "done") {
      return "done";
    }
    if (index > current) {
      return "pending";
    }
    return progress.kind === "failed" ? "failed" : "current";
  }

  private indexOf(step: CalibrationStep): number {
    const index = this.steps.findIndex((item) => item.key === step);
    return index < 0 ? 1 : index;
  }
}
