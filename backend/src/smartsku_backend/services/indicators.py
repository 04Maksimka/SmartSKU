from smartsku_backend.messaging.contracts import IndicatorsCommand, LedColor


class IndicatorPolicy:
    """Display shows the piece count; the LED is reserved for future scenarios and stays off."""

    def build(self, box_id: str, locker_id: int, nfc_flag: bool, quantity: int | None) -> IndicatorsCommand:
        screen_number = quantity if nfc_flag and quantity is not None else 0
        return IndicatorsCommand(
            box_id=box_id, locker_id=locker_id, led_color=LedColor.NONE, screen_number=screen_number
        )
