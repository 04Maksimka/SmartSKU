from dataclasses import dataclass

from smartsku_backend.messaging.contracts import IndicatorsCommand, LockerReading


@dataclass(frozen=True)
class SlotObservation:
    """What the journal would record for a slot: the cell in it (None — empty) and its quantity (None — not counted)."""

    nfc_id: str | None
    quantity: int | None
    weight: float

    def same_as(self, other: "SlotObservation") -> bool:
        return self.nfc_id == other.nfc_id and self.quantity == other.quantity


@dataclass(frozen=True)
class PendingObservation:
    observation: SlotObservation
    since: float
    hold_seconds: float

    def confirmed(self, now: float) -> bool:
        return now - self.since >= self.hold_seconds


class LockerRuntimeCache:
    """In-memory view of the last processed reading and last sent indicators per locker.

    Boxes send telemetry every ~0.5s; this cache lets the backend skip the database for unchanged readings
    and avoid re-sending identical indicator commands.
    """

    def __init__(self) -> None:
        self._readings: dict[tuple[str, int], LockerReading] = {}
        self._indicators: dict[tuple[str, int], IndicatorsCommand] = {}
        self._pending: dict[tuple[str, int], PendingObservation] = {}

    def is_significant(self, box_id: str, reading: LockerReading, weight_threshold: float) -> bool:
        previous = self._readings.get((box_id, reading.locker_id))
        if previous is None:
            return True
        return (
            previous.nfc_flag != reading.nfc_flag
            or previous.nfc_id != reading.nfc_id
            or previous.piece_weight != reading.piece_weight
            or previous.slot_ready != reading.slot_ready
            or previous.cell_tared != reading.cell_tared
            or previous.tag_error != reading.tag_error
            or previous.calibration != reading.calibration
            or abs(previous.weight - reading.weight) >= weight_threshold
        )

    def remember_reading(self, box_id: str, reading: LockerReading) -> None:
        self._readings[(box_id, reading.locker_id)] = reading

    def indicators_changed(self, command: IndicatorsCommand) -> bool:
        return self._indicators.get((command.box_id, command.locker_id)) != command

    def remember_indicators(self, command: IndicatorsCommand) -> None:
        self._indicators[(command.box_id, command.locker_id)] = command

    def hold(self, box_id: str, locker_id: int, observation: SlotObservation, now: float, hold_seconds: float) -> None:
        """Wait for the observation to hold; the same one again keeps its start time, a new one starts over."""
        key = (box_id, locker_id)
        pending = self._pending.get(key)
        since = now if pending is None or not pending.observation.same_as(observation) else pending.since
        self._pending[key] = PendingObservation(observation, since, hold_seconds)

    def drop_pending(self, box_id: str, locker_id: int) -> None:
        self._pending.pop((box_id, locker_id), None)

    def take_confirmed(self, box_id: str, locker_id: int, now: float) -> SlotObservation | None:
        """The observation that has held long enough, removed from waiting; None if there is none yet."""
        key = (box_id, locker_id)
        pending = self._pending.get(key)
        if pending is None or not pending.confirmed(now):
            return None
        del self._pending[key]
        return pending.observation

    def has_confirmed(self, box_id: str, locker_id: int, now: float) -> bool:
        pending = self._pending.get((box_id, locker_id))
        return pending is not None and pending.confirmed(now)

    def forget_box(self, box_id: str) -> None:
        for storage in (self._readings, self._indicators, self._pending):
            for key in [key for key in storage if key[0] == box_id]:
                del storage[key]
