import pytest

from smartsku_emulator.domain.errors import ConflictError, NotFoundError
from smartsku_emulator.domain.model import Fleet, VirtualBox


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
