from smartsku_backend.db.models import Component
from smartsku_backend.messaging.contracts import LockerReading
from smartsku_backend.services.indicators import IndicatorPolicy
from smartsku_backend.services.runtime_cache import LockerRuntimeCache


class TestIndicatorPolicy:
    def test_display_shows_quantity(self) -> None:
        command = IndicatorPolicy().build("box", 0, True, 3)
        assert command.screen_number == 3

    def test_removed_or_uncalibrated_cell_shows_dashes(self) -> None:
        policy = IndicatorPolicy()
        assert policy.build("box", 0, False, 10).screen_number is None
        assert policy.build("box", 0, True, None).screen_number is None

    def test_calibrated_empty_cell_shows_zero(self) -> None:
        assert IndicatorPolicy().build("box", 0, True, 0).screen_number == 0


class TestComponent:
    def test_quantity_rounds_to_nearest_piece(self) -> None:
        component = Component(piece_weight=2.5)
        assert component.quantity_for(49.2) == 20
        assert component.quantity_for(0.4) == 0


class TestLockerRuntimeCache:
    def _reading(self, weight: float, nfc_flag: bool = True) -> LockerReading:
        return LockerReading(
            locker_id=0, nfc_flag=nfc_flag, nfc_id="cell", weight=weight, piece_weight=2.5, number_of_pieces=0
        )

    def test_noise_below_threshold_is_ignored(self) -> None:
        cache = LockerRuntimeCache()
        assert cache.is_significant("box", self._reading(50.0), 0.5)
        cache.remember_reading("box", self._reading(50.0))
        assert not cache.is_significant("box", self._reading(50.3), 0.5)
        assert cache.is_significant("box", self._reading(51.0), 0.5)
        assert cache.is_significant("box", self._reading(50.0, nfc_flag=False), 0.5)

    def test_forget_box_forces_reprocessing(self) -> None:
        cache = LockerRuntimeCache()
        cache.remember_reading("box", self._reading(50.0))
        cache.forget_box("box")
        assert cache.is_significant("box", self._reading(50.0), 0.5)

    def test_empty_nfc_id_from_firmware_is_none(self) -> None:
        reading = LockerReading(locker_id=0, nfc_flag=False, nfc_id="", weight=0, piece_weight=0, number_of_pieces=0)
        assert reading.nfc_id is None
