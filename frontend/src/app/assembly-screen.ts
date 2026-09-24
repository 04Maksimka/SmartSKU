import type { AssemblyPick } from "../api/types";

/** What a pick asks of the person at the slot. */
export type PickState = "take" | "put" | "done";

/**
 * Slot displays during an assembly, by the same rules as the firmware (CountDisplay::showTask): "t" and the pieces
 * still to take, "P" and the pieces to put back, dark when there is nothing to do. The number takes three digits.
 */
export class AssemblyScreen {
  static readonly MAX_NUMBER = 999;

  state(pick: AssemblyPick): PickState {
    return pick.remaining > 0 ? "take" : pick.remaining < 0 ? "put" : "done";
  }

  text(pick: AssemblyPick | null): string {
    if (pick === null || pick.remaining === 0) {
      return "    ";
    }
    const letter = pick.remaining > 0 ? "t" : "P";
    const number = Math.abs(pick.remaining);
    return letter + (number > AssemblyScreen.MAX_NUMBER ? "OFL" : String(number).padStart(3));
  }

  /** Plain words for the same task. */
  hint(pick: AssemblyPick): string {
    switch (this.state(pick)) {
      case "take":
        return `взять ${pick.remaining} шт`;
      case "put":
        return `положить обратно ${-pick.remaining} шт`;
      default:
        return "готово";
    }
  }
}
