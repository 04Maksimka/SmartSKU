from smartsku_backend.messaging.contracts import IndicatorsCommand, ScreenMode


class IndicatorPolicy:
    """Display shows the piece count, or dashes when there is nothing to count.

    While an assembly runs, only the slots of its cells stay lit: "t N" — take N more, "P M" — put M back; a slot
    with nothing to do (or its cell done) goes dark. A cell the user is looking for blinks, showing the same.
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
        blink: bool = False,
    ) -> IndicatorsCommand:
        if assembling:
            command = self._assembly(box_id, locker_id, remaining)
        else:
            # A zero on an uncalibrated or pulled-out cell reads as "empty", which it is not
            screen_number = quantity if nfc_flag else None
            command = IndicatorsCommand(box_id=box_id, locker_id=locker_id, screen_number=screen_number)
        return command.model_copy(update={"blink": blink}) if blink else command

    def _assembly(self, box_id: str, locker_id: int, remaining: int | None) -> IndicatorsCommand:
        if not remaining:
            mode, number = ScreenMode.OFF, None
        elif remaining > 0:
            mode, number = ScreenMode.TAKE, remaining
        else:
            mode, number = ScreenMode.PUT, -remaining
        return IndicatorsCommand(box_id=box_id, locker_id=locker_id, screen_number=number, screen_mode=mode)
