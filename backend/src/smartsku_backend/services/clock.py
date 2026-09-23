import time


class MonotonicClock:
    """Seconds for measuring how long a reading holds; replaced by a fake clock in tests."""

    def now(self) -> float:
        return time.monotonic()
