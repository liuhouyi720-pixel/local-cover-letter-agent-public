import asyncio
from time import monotonic


class RateLimiter:
    def __init__(self, interval_seconds: float) -> None:
        self.interval_seconds = interval_seconds
        self._last_request_at: float | None = None
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            if self._last_request_at is not None:
                remaining = self.interval_seconds - (
                    monotonic() - self._last_request_at
                )
                if remaining > 0:
                    await asyncio.sleep(remaining)
            self._last_request_at = monotonic()
