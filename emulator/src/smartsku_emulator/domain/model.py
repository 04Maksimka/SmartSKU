import logging
import random

from smartsku_emulator.domain.errors import ConflictError, NotFoundError
from smartsku_emulator.messaging.contracts import LockerReading

logger = logging.getLogger(__name__)


class VirtualCell:
    """A removable cell with an NFC tag. Starts empty; its contents travel with it when it is pulled out."""

    def __init__(self, nfc_id: str) -> None:
        self.nfc_id = nfc_id
        self.weight = 0.0

    def add_grams(self, grams: float) -> None:
        self.weight = max(0.0, self.weight + grams)


class VirtualLocker:
    """A load cell slot inside a box, with its LED and display."""

    def __init__(self, locker_id: int) -> None:
        self.locker_id = locker_id
        self.cell: VirtualCell | None = None
        self.pending_calibration: int | None = None
        self.led_color = "none"
        self.screen_number = 0


class VirtualBox:
    """Mirrors the ESP32 firmware logic: tare-adjusted weight, per-cell piece weight, command handling."""

    def __init__(self, hardware_id: str, lockers_count: int, box_id: str | None) -> None:
        self.hardware_id = hardware_id
        self.box_id = box_id
        self.connected = False
        self.lockers = {locker_id: VirtualLocker(locker_id) for locker_id in range(lockers_count)}
        self.piece_weights: dict[str, float] = {}

    def locker(self, locker_id: int) -> VirtualLocker:
        if locker_id not in self.lockers:
            raise NotFoundError(f"Box {self.hardware_id} has no locker {locker_id}")
        return self.lockers[locker_id]

    def insert(self, locker_id: int, cell: VirtualCell) -> None:
        locker = self.locker(locker_id)
        if locker.cell is not None:
            raise ConflictError(f"Locker {locker_id} of box {self.hardware_id} already holds {locker.cell.nfc_id}")
        locker.cell = cell
        if locker.pending_calibration is None:
            return
        if cell.weight <= 0:
            logger.warning(
                "Box %s locker %s: cell %s inserted empty, calibration still waits for components",
                self.hardware_id,
                locker_id,
                cell.nfc_id,
            )
            return
        self.piece_weights[cell.nfc_id] = cell.weight / locker.pending_calibration
        locker.pending_calibration = None

    def remove(self, locker_id: int) -> VirtualCell:
        locker = self.locker(locker_id)
        if locker.cell is None:
            raise ConflictError(f"Locker {locker_id} of box {self.hardware_id} is empty")
        cell, locker.cell = locker.cell, None
        return cell

    def apply_calibration(self, locker_id: int, num_of_pieces: int) -> None:
        self.locker(locker_id).pending_calibration = num_of_pieces

    def apply_indicators(self, locker_id: int, led_color: str, screen_number: int) -> None:
        locker = self.locker(locker_id)
        locker.led_color = led_color
        locker.screen_number = screen_number

    def readings(self, noise_grams: float) -> list[LockerReading]:
        readings = []
        for locker in self.lockers.values():
            if locker.cell is None:
                readings.append(
                    LockerReading(
                        locker_id=locker.locker_id,
                        nfc_flag=False,
                        nfc_id="",
                        weight=0.0,
                        piece_weight=0.0,
                        number_of_pieces=0,
                    )
                )
                continue
            weight = max(0.0, locker.cell.weight + (random.gauss(0.0, noise_grams) if noise_grams > 0 else 0.0))
            piece_weight = self.piece_weights.get(locker.cell.nfc_id, 0.0)
            readings.append(
                LockerReading(
                    locker_id=locker.locker_id,
                    nfc_flag=True,
                    nfc_id=locker.cell.nfc_id,
                    weight=round(weight, 2),
                    piece_weight=round(piece_weight, 4),
                    number_of_pieces=round(weight / piece_weight) if piece_weight > 0 else 0,
                )
            )
        return readings


class Fleet:
    """All emulated boxes plus cells that are currently pulled out and carried around."""

    def __init__(self) -> None:
        self.boxes: dict[str, VirtualBox] = {}
        self.loose_cells: dict[str, VirtualCell] = {}

    def box(self, hardware_id: str) -> VirtualBox:
        if hardware_id not in self.boxes:
            raise NotFoundError(f"Box {hardware_id} not found")
        return self.boxes[hardware_id]

    def add_box(self, box: VirtualBox) -> None:
        if box.hardware_id in self.boxes:
            raise ConflictError(f"Box {box.hardware_id} already exists")
        self.boxes[box.hardware_id] = box

    def create_cell(self, nfc_id: str) -> VirtualCell:
        if self._locate(nfc_id) is not None:
            raise ConflictError(f"Cell {nfc_id} already exists")
        cell = VirtualCell(nfc_id)
        self.loose_cells[nfc_id] = cell
        return cell

    def add_grams(self, nfc_id: str, grams: float) -> VirtualCell:
        cell = self.cell(nfc_id)
        cell.add_grams(grams)
        return cell

    def add_pieces(self, nfc_id: str, pieces: int) -> VirtualCell:
        piece_weight = self.calibrated_piece_weight(nfc_id)
        if piece_weight is None:
            raise ConflictError(f"Cell {nfc_id} is not calibrated yet, change its weight in grams")
        return self.add_grams(nfc_id, pieces * piece_weight)

    def calibrated_piece_weight(self, nfc_id: str) -> float | None:
        for box in self.boxes.values():
            if nfc_id in box.piece_weights:
                return box.piece_weights[nfc_id]
        return None

    def pull_out(self, hardware_id: str, locker_id: int) -> VirtualCell:
        cell = self.box(hardware_id).remove(locker_id)
        self.loose_cells[cell.nfc_id] = cell
        return cell

    def insert(self, hardware_id: str, locker_id: int, nfc_id: str) -> None:
        if nfc_id not in self.loose_cells:
            raise NotFoundError(f"Cell {nfc_id} is not pulled out")
        self.box(hardware_id).insert(locker_id, self.loose_cells[nfc_id])
        del self.loose_cells[nfc_id]

    def cell(self, nfc_id: str) -> VirtualCell:
        cell = self._locate(nfc_id)
        if cell is None:
            raise NotFoundError(f"Cell {nfc_id} not found")
        return cell

    def _locate(self, nfc_id: str) -> VirtualCell | None:
        if nfc_id in self.loose_cells:
            return self.loose_cells[nfc_id]
        for box in self.boxes.values():
            for locker in box.lockers.values():
                if locker.cell is not None and locker.cell.nfc_id == nfc_id:
                    return locker.cell
        return None
