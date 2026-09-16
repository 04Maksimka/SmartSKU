from pathlib import Path

import pytest

from smartsku_emulator.domain.errors import ConflictError, NotFoundError
from smartsku_emulator.domain.model import Fleet, VirtualBox
from smartsku_emulator.domain.state_store import FleetStateStore


class TestFleet:
    def _fleet(self) -> Fleet:
        fleet = Fleet()
        fleet.add_box(VirtualBox("hw-1", lockers_count=4, box_id="box-1"))
        fleet.create_cell("cell-1")
        fleet.insert("hw-1", 0, "cell-1")
        return fleet

    def test_new_cell_is_empty_and_uncalibrated(self) -> None:
        reading = self._fleet().box("hw-1").readings(noise_grams=0.0)[0]
        assert (reading.nfc_flag, reading.weight, reading.piece_weight, reading.number_of_pieces) == (
            True,
            0.0,
            0.0,
            0,
        )

    def test_calibration_derives_piece_weight_from_poured_grams(self) -> None:
        fleet = self._fleet()
        box = fleet.box("hw-1")
        box.apply_calibration(0, 20)
        fleet.pull_out("hw-1", 0)
        fleet.add_grams("cell-1", 50.0)
        fleet.insert("hw-1", 0, "cell-1")

        reading = box.readings(noise_grams=0.0)[0]
        assert (reading.weight, reading.piece_weight, reading.number_of_pieces) == (50.0, 2.5, 20)
        assert box.lockers[0].pending_calibration is None

        fleet.add_pieces("cell-1", -3)
        assert box.readings(noise_grams=0.0)[0].number_of_pieces == 17

    def test_pieces_require_calibration(self) -> None:
        with pytest.raises(ConflictError):
            self._fleet().add_pieces("cell-1", 1)

    def test_pulled_out_cell_reads_as_empty_locker(self) -> None:
        fleet = self._fleet()
        fleet.pull_out("hw-1", 0)
        reading = fleet.box("hw-1").readings(noise_grams=0.0)[0]
        assert (reading.nfc_flag, reading.nfc_id, reading.weight) == (False, "", 0.0)

    def test_invalid_moves_are_rejected(self) -> None:
        fleet = self._fleet()
        fleet.create_cell("cell-2")
        with pytest.raises(ConflictError):
            fleet.insert("hw-1", 0, "cell-2")
        with pytest.raises(NotFoundError):
            fleet.insert("hw-1", 9, "cell-2")
        with pytest.raises(ConflictError):
            fleet.create_cell("cell-1")


class TestFleetState:
    """A restarted emulator must keep weights and calibration, like a box that was powered off."""

    def _stored_fleet(self, path: Path) -> tuple[Fleet, FleetStateStore]:
        store = FleetStateStore(path)
        fleet = Fleet(store)
        store.attach(fleet)
        fleet.add_box(VirtualBox("hw-1", lockers_count=4, box_id="box-1"))
        fleet.create_cell("cell-1")
        fleet.insert("hw-1", 0, "cell-1")
        return fleet, store

    def test_state_survives_restart(self, tmp_path: Path) -> None:
        fleet, _ = self._stored_fleet(tmp_path / "state.json")
        fleet.box("hw-1").apply_calibration(0, 20)
        fleet.pull_out("hw-1", 0)
        fleet.add_grams("cell-1", 50.0)
        fleet.insert("hw-1", 0, "cell-1")
        fleet.create_cell("cell-2")
        fleet.pull_out("hw-1", 0)

        restarted = Fleet(FleetStateStore(tmp_path / "state.json"))
        state = FleetStateStore(tmp_path / "state.json").load()
        assert state is not None
        restarted.restore(state)

        box = restarted.box("hw-1")
        assert box.box_id == "box-1"
        assert box.piece_weights == {"cell-1": 2.5}
        assert box.lockers[0].cell is None
        assert sorted(restarted.loose_cells) == ["cell-1", "cell-2"]
        assert restarted.cell("cell-1").weight == 50.0

        restarted.insert("hw-1", 0, "cell-1")
        reading = box.readings(noise_grams=0.0)[0]
        assert (reading.weight, reading.piece_weight, reading.number_of_pieces) == (50.0, 2.5, 20)

    def test_pending_calibration_survives_restart(self, tmp_path: Path) -> None:
        fleet, _ = self._stored_fleet(tmp_path / "state.json")
        fleet.box("hw-1").apply_calibration(0, 10)

        state = FleetStateStore(tmp_path / "state.json").load()
        assert state is not None
        restarted = Fleet()
        restarted.restore(state)
        assert restarted.box("hw-1").lockers[0].pending_calibration == 10
