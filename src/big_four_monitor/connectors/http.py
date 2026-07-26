import asyncio
from email.utils import parsedate_to_datetime
from logging import Logger
from time import time

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..utils.rate_limit import RateLimiter
from ..utils.retry import (
    BlockedSourceError,
    InvalidSourceResponseError,
    TransientHttpError,
)


CHALLENGE_MARKERS = (
    "captcha",
    "access denied",
    "verify you are human",
    "checking your browser",
    "attention required",
)


class SafeHttpClient:
    def __init__(
        self,
        *,
        user_agent: str,
        timeout_seconds: float,
        interval_seconds: float,
        max_retries: int,
        logger: Logger,
    ) -> None:
        self.client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout_seconds,
            headers={"User-Agent": user_agent, "Accept": "text/html"},
        )
        self.rate_limiter = RateLimiter(interval_seconds)
        self.max_retries = max_retries
        self.logger = logger

    async def close(self) -> None:
        await self.client.aclose()

    async def get_html(self, url: str) -> str:
        retrying = AsyncRetrying(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception_type(
                (httpx.TransportError, TransientHttpError)
            ),
            reraise=True,
        )
        async for attempt in retrying:
            with attempt:
                await self.rate_limiter.wait()
                response = await self.client.get(url)
                if response.status_code == 403:
                    raise BlockedSourceError(f"403 Forbidden from {url}")
                if response.status_code == 429:
                    delay = self._retry_after_seconds(response)
                    self.logger.warning(
                        "Rate limited by %s; waiting %.1f seconds", url, delay
                    )
                    await asyncio.sleep(delay)
                    raise TransientHttpError(f"429 Too Many Requests from {url}")
                if response.status_code >= 500:
                    raise TransientHttpError(
                        f"{response.status_code} server error from {url}"
                    )
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if "text/html" not in content_type:
                    raise InvalidSourceResponseError(
                        f"Expected HTML from {url}, got {content_type or 'unknown'}"
                    )
                lowered = response.text[:100_000].casefold()
                if any(marker in lowered for marker in CHALLENGE_MARKERS):
                    raise BlockedSourceError(
                        f"Challenge or access-denied page returned by {url}"
                    )
                return response.text
        raise AssertionError("retry loop ended without a response")

    @staticmethod
    def _retry_after_seconds(response: httpx.Response) -> float:
        value = response.headers.get("retry-after")
        if not value:
            return 5
        try:
            return min(max(float(value), 1), 30)
        except ValueError:
            try:
                parsed = parsedate_to_datetime(value).timestamp()
                return min(max(parsed - time(), 1), 30)
            except (TypeError, ValueError, OverflowError):
                return 5
