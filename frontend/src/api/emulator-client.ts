import type { EmulatorBox, EmulatorCell } from "./emulator-types";
import { HttpClient } from "./http-client";

/** The emulator stands in for real hardware, so its panel does what a person would do at the rack. */
export class EmulatorClient extends HttpClient {
  boxes(): Promise<EmulatorBox[]> {
    return this.get("/boxes");
  }

  looseCells(): Promise<EmulatorCell[]> {
    return this.get("/cells");
  }

  createBox(hardwareId: string, lockersCount: number): Promise<EmulatorBox> {
    return this.send("/boxes", "POST", { hardware_id: hardwareId, lockers_count: lockersCount });
  }

  createCell(nfcId: string): Promise<EmulatorCell> {
    return this.send("/cells", "POST", { nfc_id: nfcId });
  }

  pullOut(hardwareId: string, lockerId: number): Promise<EmulatorCell> {
    return this.send(`/boxes/${encodeURIComponent(hardwareId)}/lockers/${lockerId}/pull-out`, "POST");
  }

  insert(hardwareId: string, lockerId: number, nfcId: string): Promise<EmulatorBox> {
    return this.send(`/boxes/${encodeURIComponent(hardwareId)}/lockers/${lockerId}/insert`, "POST", {
      nfc_id: nfcId,
    });
  }

  addGrams(nfcId: string, grams: number): Promise<EmulatorCell> {
    return this.send(`/cells/${encodeURIComponent(nfcId)}/grams`, "POST", { grams });
  }

  addPieces(nfcId: string, pieces: number): Promise<EmulatorCell> {
    return this.send(`/cells/${encodeURIComponent(nfcId)}/pieces`, "POST", { pieces });
  }
}
