import logging
import random
from typing import Any

from smartsku_emulator.domain.errors import ConflictError, NotFoundError
from smartsku_emulator.domain.state_store import NullFleetStateStore
from smartsku_emulator.messaging.contracts import LockerReading

logger = logging.getLogger(__name__)


class VirtualCell:
    """A removable cell with an NFC tag. Starts empty; its contents travel with it when it is pulled out."""

    def __init__(self, nfc_id: str) -> None:
        self.nfc_id = nfc_id
        self.weight = 0.0

    def add_grams(self, grams: float) -> None:
        self.weight = max(0.0, self.weight + grams)

    def snapshot(self) -> dict[str, Any]:
        return {"nfc_id": self.nfc_id, "weight": self.weight}

    @classmethod
    def restored(cls, data: dict[str, Any]) -> "VirtualCell":
        cell = cls(str(data["nfc_id"]))
        cell.weight = float(data.get("weight", 0.0))
        return cell


class TareResult:
    """What a box reports after setting a zero: the cell and the weight taken as zero."""

    def __init__(self, cell_nfc_id: str, tare: float) -> None:
        self.cell_nfc_id = cell_nfc_id
        self.tare = tare


class VirtualLocker:
    """A load cell slot inside a box, with its LED and display.

    Like the firmware, a new slot has no zero: until the empty cell is tared it reports zeroed=false and weight 0.
    The zero is the cell weight at the moment of taring, so taring a filled cell hides its contents.
    """

    def __init__(self, locker_id: int) -> None:
        self.locker_id = locker_id
        self.cell: VirtualCell | None = None
        self.pending_calibration: int | None = None
        self.zero_offset: float | None = None
        self.led_color = "none"
        self.screen_number: int | None = None


class VirtualBox:
    """Mirrors the ESP32 firmware logic: tare-adjusted weight, per-cell piece weight, command handling."""

    def __init__(self, hardware_id: str, lockers_count: int, box_id: str | None) -> None:
        self.hardware_id = hardware_id
        self.box_id = box_id
        self.connected = False
        self.lockers = {locker_id: VirtualLocker(locker_id) for locker_id in range(lockers_count)}
        self.piece_weights: dict[str, float] = {}
        self._store: NullFleetStateStore = NullFleetStateStore()

    def attach_store(self, store: NullFleetStateStore) -> None:
        self._store = store

    def locker(self, locker_id: int) -> VirtualLocker:
        if locker_id not in self.lockers:
            raise NotFoundError(f"Box {self.hardware_id} has no locker {locker_id}")
        return self.lockers[locker_id]

    def insert(self, locker_id: int, cell: VirtualCell) -> None:
        locker = self.locker(locker_id)
        if locker.cell is not None:
            raise ConflictError(f"Locker {locker_id} of box {self.hardware_id} already holds {locker.cell.nfc_id}")
        locker.cell = cell
        if locker.pending_calibration is None or locker.zero_offset is None:
            return
        weight = self._net_weight(locker)
        if weight <= 0:
            logger.warning(
                "Box %s locker %s: cell %s inserted empty, calibration still waits for components",
                self.hardware_id,
                locker_id,
                cell.nfc_id,
            )
            return
        self.piece_weights[cell.nfc_id] = weight / locker.pending_calibration
        locker.pending_calibration = None
        self._store.record()

    def remove(self, locker_id: int) -> VirtualCell:
        locker = self.locker(locker_id)
        if locker.cell is None:
            raise ConflictError(f"Locker {locker_id} of box {self.hardware_id} is empty")
        cell, locker.cell = locker.cell, None
        return cell

    def apply_calibration(self, locker_id: int, num_of_pieces: int) -> None:
        self.locker(locker_id).pending_calibration = num_of_pieces
        self._store.record()

    def apply_tare(self, locker_id: int) -> "TareResult":
        locker = self.locker(locker_id)
        if locker.cell is None:
            raise ConflictError(f"Locker {locker_id} of box {self.hardware_id}: insert the empty cell before taring")
        locker.zero_offset = locker.cell.weight
        self._store.record()
        return TareResult(cell_nfc_id=locker.cell.nfc_id, tare=locker.zero_offset)

    def apply_indicators(self, locker_id: int, led_color: str, screen_number: int | None) -> None:
        locker = self.locker(locker_id)
        locker.led_color = led_color
        locker.screen_number = screen_number

    def snapshot(self) -> dict[str, Any]:
        return {
            "hardware_id": self.hardware_id,
            "box_id": self.box_id,
            "lockers_count": len(self.lockers),
            "piece_weights": self.piece_weights,
            "lockers": [
                {
                    "locker_id": locker.locker_id,
                    "nfc_id": locker.cell.nfc_id if locker.cell else None,
                    "pending_calibration": locker.pending_calibration,
                    "zero_offset": locker.zero_offset,
                }
                for locker in self.lockers.values()
            ],
        }

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
                        zeroed=locker.zero_offset is not None,
                    )
                )
                continue
            piece_weight = self.piece_weights.get(locker.cell.nfc_id, 0.0)
            if locker.zero_offset is None:
                readings.append(
                    LockerReading(
                        locker_id=locker.locker_id,
                        nfc_flag=True,
                        nfc_id=locker.cell.nfc_id,
                        weight=0.0,
                        piece_weight=round(piece_weight, 4),
                        number_of_pieces=0,
                        zeroed=False,
                    )
                )
                continue
            noise = random.gauss(0.0, noise_grams) if noise_grams > 0 else 0.0
            weight = max(0.0, self._net_weight(locker) + noise)
            readings.append(
                LockerReading(
                    locker_id=locker.locker_id,
                    nfc_flag=True,
                    nfc_id=locker.cell.nfc_id,
                    weight=round(weight, 2),
                    piece_weight=round(piece_weight, 4),
                    number_of_pieces=round(weight / piece_weight) if piece_weight > 0 else 0,
                    zeroed=True,
                )
            )
        return readings

    def _net_weight(self, locker: VirtualLocker) -> float:
        if locker.cell is None or locker.zero_offset is None:
            return 0.0
        return max(0.0, locker.cell.weight - locker.zero_offset)


class Fleet:
    """All emulated boxes plus cells that are currently pulled out and carried around."""

    def __init__(self, store: NullFleetStateStore | None = None) -> None:
        self.boxes: dict[str, VirtualBox] = {}
        self.loose_cells: dict[str, VirtualCell] = {}
        self._store = store or NullFleetStateStore()

    def box(self, hardware_id: str) -> VirtualBox:
        if hardware_id not in self.boxes:
            raise NotFoundError(f"Box {hardware_id} not found")
        return self.boxes[hardware_id]

    def add_box(self, box: VirtualBox) -> None:
        if box.hardware_id in self.boxes:
            raise ConflictError(f"Box {box.hardware_id} already exists")
        box.attach_store(self._store)
        self.boxes[box.hardware_id] = box
        self._store.record()

    def create_cell(self, nfc_id: str) -> VirtualCell:
        if self._locate(nfc_id) is not None:
            raise ConflictError(f"Cell {nfc_id} already exists")
        cell = VirtualCell(nfc_id)
        self.loose_cells[nfc_id] = cell
        self._store.record()
        return cell

    def add_grams(self, nfc_id: str, grams: float) -> VirtualCell:
        cell = self.cell(nfc_id)
        cell.add_grams(grams)
        self._store.record()
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
        self._store.record()
        return cell

    def insert(self, hardware_id: str, locker_id: int, nfc_id: str) -> None:
        if nfc_id not in self.loose_cells:
            raise NotFoundError(f"Cell {nfc_id} is not pulled out")
        self.box(hardware_id).insert(locker_id, self.loose_cells[nfc_id])
        del self.loose_cells[nfc_id]
        self._store.record()

    def snapshot(self) -> dict[str, Any]:
        cells = [cell.snapshot() for cell in self.loose_cells.values()]
        for box in self.boxes.values():
            cells.extend(locker.cell.snapshot() for locker in box.lockers.values() if locker.cell is not None)
        return {"boxes": [box.snapshot() for box in self.boxes.values()], "cells": cells}

    def restore(self, state: dict[str, Any]) -> None:
        """Rebuilds the fleet saved before the restart; config seeds are ignored while that state exists."""
        cells = {str(data["nfc_id"]): VirtualCell.restored(data) for data in state.get("cells", [])}
        self.loose_cells = dict(cells)
        for box_data in state.get("boxes", []):
            box = VirtualBox(
                str(box_data["hardware_id"]),
                int(box_data.get("lockers_count", 4)),
                box_data.get("box_id"),
            )
            box.piece_weights = {str(nfc_id): float(weight) for nfc_id, weight in box_data["piece_weights"].items()}
            box.attach_store(self._store)
            self.boxes[box.hardware_id] = box
            for locker_data in box_data.get("lockers", []):
                locker = box.locker(int(locker_data["locker_id"]))
                locker.pending_calibration = locker_data.get("pending_calibration")
                locker.zero_offset = locker_data.get("zero_offset", 0.0)
                nfc_id = locker_data.get("nfc_id")
                if nfc_id is not None and nfc_id in cells:
                    locker.cell = cells[nfc_id]
                    self.loose_cells.pop(nfc_id, None)

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
