from smartsku_backend.messaging.contracts import IndicatorsCommand, LockerReading


class LockerRuntimeCache:
    """In-memory view of the last processed reading and last sent indicators per locker.

    Boxes send telemetry every ~0.5s; this cache lets the backend skip the database for unchanged readings
    and avoid re-sending identical indicator commands.
    """

    def __init__(self) -> None:
        self._readings: dict[tuple[str, int], LockerReading] = {}
        self._indicators: dict[tuple[str, int], IndicatorsCommand] = {}

    def is_significant(self, box_id: str, reading: LockerReading, weight_threshold: float) -> bool:
        previous = self._readings.get((box_id, reading.locker_id))
        if previous is None:
            return True
        return (
            previous.nfc_flag != reading.nfc_flag
            or previous.nfc_id != reading.nfc_id
            or previous.piece_weight != reading.piece_weight
            or previous.zeroed != reading.zeroed
            or abs(previous.weight - reading.weight) >= weight_threshold
        )

    def remember_reading(self, box_id: str, reading: LockerReading) -> None:
        self._readings[(box_id, reading.locker_id)] = reading

    def indicators_changed(self, command: IndicatorsCommand) -> bool:
        return self._indicators.get((command.box_id, command.locker_id)) != command

    def remember_indicators(self, command: IndicatorsCommand) -> None:
        self._indicators[(command.box_id, command.locker_id)] = command

    def forget_box(self, box_id: str) -> None:
        for storage in (self._readings, self._indicators):
            for key in [key for key in storage if key[0] == box_id]:
                del storage[key]
