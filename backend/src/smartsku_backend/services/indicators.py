from smartsku_backend.messaging.contracts import IndicatorsCommand, LedColor


class IndicatorPolicy:
    """Display shows the piece count, or dashes when there is nothing to count; the LED stays off for now."""

    def build(self, box_id: str, locker_id: int, nfc_flag: bool, quantity: int | None) -> IndicatorsCommand:
        # A zero on an uncalibrated or pulled-out cell reads as "empty", which it is not
        screen_number = quantity if nfc_flag else None
        return IndicatorsCommand(
            box_id=box_id, locker_id=locker_id, led_color=LedColor.NONE, screen_number=screen_number
        )
