import asyncio
from pathlib import Path

import httpx
import pytest

from big_four_monitor.connectors.http import CHALLENGE_MARKERS, SafeHttpClient
from big_four_monitor.connectors.pwc import (
    PwCConnector,
    parse_job_detail,
    parse_search_page,
)
from big_four_monitor.models import SearchRecord
from big_four_monitor.settings import FirmSettings, Settings
from big_four_monitor.utils.logging import configure_logging
from big_four_monitor.utils.retry import (
    BlockedSourceError,
    UnexpectedEmptyResultsError,
)


def _read(directory: Path, name: str) -> str:
    return (directory / name).read_text(encoding="utf-8")


def test_search_result_parsing_and_fields(fixture_directory: Path) -> None:
    records, pages, total = parse_search_page(
        _read(fixture_directory, "search_results.html")
    )
    assert pages == 2
    assert total == 3
    assert [record.source_job_id for record in records] == ["1001", "1002"]
    assert records[0].title == "Audit Intern - Summer 2027"
    assert records[0].location_summary == "Chicago, IL"
    assert records[0].career_level == "Intern/Trainee"
    assert records[0].detail_url.endswith("/932/1001")


def test_job_detail_and_apply_url_parsing(fixture_directory: Path) -> None:
    record = SearchRecord(
        firm="pwc",
        source="pwc_us_talentbrew",
        source_job_id="1001",
        title="Audit Intern - Summer 2027",
        location_summary="Chicago, IL",
        career_level="Intern/Trainee",
        country="United States",
        detail_url="https://jobs.us.pwc.com/en/job/chicago/audit/932/1001",
    )
    posting = parse_job_detail(
        record, _read(fixture_directory, "job_detail.html")
    )
    assert posting.service_line == "Audit and Assurance"
    assert posting.employment_type == "Full time"
    assert posting.locations == ["Chicago, Illinois", "New York, New York"]
    assert posting.apply_url is not None
    assert "pwc.wd3.myworkdayjobs.com" in posting.apply_url
    assert posting.posted_date is None
    assert posting.application_deadline is None


class FakeHttp:
    def __init__(self, pages: dict[str, str]) -> None:
        self.pages = pages
        self.requested: list[str] = []

    async def get_html(self, url: str) -> str:
        self.requested.append(url)
        return self.pages[url]

    async def close(self) -> None:
        return None


def _settings() -> Settings:
    return Settings(
        user_agent="test",
        request_interval_seconds=0,
        firms={
            "pwc": FirmSettings(
                enabled=True,
                source="pwc_us_talentbrew",
                search_url="https://jobs.us.pwc.com/en/search-jobs",
            )
        },
    )


def test_pagination_uses_all_search_pages(fixture_directory: Path) -> None:
    connector = PwCConnector(_settings(), configure_logging())
    search_url = connector.search_url
    fake_http = FakeHttp(
        {
            search_url: _read(fixture_directory, "search_results.html"),
            f"{search_url}?p=2": _read(
                fixture_directory, "search_results_page_2.html"
            ),
        }
    )
    connector.http = fake_http
    records = asyncio.run(connector.fetch_search_records())
    assert len(records) == 3
    assert connector.pages_fetched == 2
    assert fake_http.requested == [search_url, f"{search_url}?p=2"]


def test_unexpected_empty_results_fail_safely(fixture_directory: Path) -> None:
    connector = PwCConnector(_settings(), configure_logging())
    connector.http = FakeHttp(
        {
            connector.search_url: _read(
                fixture_directory, "empty_results.html"
            )
        }
    )
    with pytest.raises(UnexpectedEmptyResultsError):
        asyncio.run(connector.fetch_search_records())


def test_challenge_fixture_contains_detected_marker(
    fixture_directory: Path,
) -> None:
    html = _read(fixture_directory, "challenge_page.html").casefold()
    assert any(marker in html for marker in CHALLENGE_MARKERS)


def test_http_client_stops_on_challenge_page(fixture_directory: Path) -> None:
    html = _read(fixture_directory, "challenge_page.html")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text=html,
            request=request,
        )

    client = SafeHttpClient(
        user_agent="test",
        timeout_seconds=1,
        interval_seconds=0,
        max_retries=1,
        logger=configure_logging(),
    )
    asyncio.run(client.client.aclose())
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(BlockedSourceError):
        asyncio.run(client.get_html("https://jobs.example.com"))
    asyncio.run(client.close())
