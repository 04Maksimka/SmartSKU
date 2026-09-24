from smartsku_backend.messaging.contracts import IndicatorsCommand, LedColor, ScreenMode


class IndicatorPolicy:
    """Display shows the piece count, or dashes when there is nothing to count; the LED stays off.

    While an assembly runs, only the slots of its cells stay lit: "t N" — take N more, "P M" — put M back; a slot
    with nothing to do (or its cell done) goes dark. The LED hints the same: green — take, red — put back.
    """

    def build(
        self,
        box_id: str,
        locker_id: int,
        nfc_flag: bool,
        quantity: int | None,
        *,
        assembling: bool = False,
        remaining: int | None = None,
    ) -> IndicatorsCommand:
        if assembling:
            return self._assembly(box_id, locker_id, remaining)
        # A zero on an uncalibrated or pulled-out cell reads as "empty", which it is not
        screen_number = quantity if nfc_flag else None
        return IndicatorsCommand(
            box_id=box_id, locker_id=locker_id, led_color=LedColor.NONE, screen_number=screen_number
        )

    def _assembly(self, box_id: str, locker_id: int, remaining: int | None) -> IndicatorsCommand:
        if not remaining:
            mode, color, number = ScreenMode.OFF, LedColor.NONE, None
        elif remaining > 0:
            mode, color, number = ScreenMode.TAKE, LedColor.GREEN, remaining
        else:
            mode, color, number = ScreenMode.PUT, LedColor.RED, -remaining
        return IndicatorsCommand(
            box_id=box_id, locker_id=locker_id, led_color=color, screen_number=number, screen_mode=mode
        )
