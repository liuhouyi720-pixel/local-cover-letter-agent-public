from datetime import datetime, timezone
from logging import Logger
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from ..models import JobPosting, SearchRecord
from ..parsing.locations import split_locations
from ..parsing.normalizer import normalize_whitespace
from ..parsing.urls import canonicalize_url
from ..settings import Settings
from ..utils.retry import InvalidSourceResponseError, UnexpectedEmptyResultsError
from .base import BaseConnector
from .http import SafeHttpClient


BASE_URL = "https://jobs.us.pwc.com"
SEARCH_URL = f"{BASE_URL}/en/search-jobs"
SOURCE_NAME = "pwc_us_talentbrew"


def parse_search_page(html: str) -> tuple[list[SearchRecord], int, int | None]:
    soup = BeautifulSoup(html, "lxml")
    records: list[SearchRecord] = []
    for item in soup.select("li.search-results-list__item"):
        link = item.select_one("a.search-results-list__job-link")
        if not isinstance(link, Tag):
            continue
        source_job_id = normalize_whitespace(link.get("data-job-id"))
        title = normalize_whitespace(link.get_text(" ", strip=True))
        href = link.get("href")
        if not source_job_id or not title or not isinstance(href, str):
            continue
        location_node = item.select_one("li.job-location")
        level_node = item.select_one("li.job-level")
        records.append(
            SearchRecord(
                firm="pwc",
                source=SOURCE_NAME,
                source_job_id=source_job_id,
                title=title,
                location_summary=normalize_whitespace(
                    location_node.get_text(" ", strip=True)
                    if location_node
                    else None
                ),
                service_line=None,
                career_level=normalize_whitespace(
                    level_node.get_text(" ", strip=True) if level_node else None
                ),
                country="United States",
                detail_url=canonicalize_url(str(href), BASE_URL),
            )
        )

    total_pages = 1
    page_count = soup.select_one(".pagination-total-pages")
    if page_count:
        match = re.search(r"(\d+)", page_count.get_text(" ", strip=True))
        if match:
            total_pages = int(match.group(1))

    results_list = soup.select_one("#search-results-jobs")
    raw_total = results_list.get("data-results-count") if results_list else None
    expected_total = int(raw_total) if raw_total and str(raw_total).isdigit() else None
    return records, total_pages, expected_total


def parse_job_detail(record: SearchRecord, html: str) -> JobPosting:
    soup = BeautifulSoup(html, "lxml")
    description_node = soup.select_one(".ats-description")
    if not description_node:
        raise InvalidSourceResponseError(
            f"PwC detail page lacked a job description: {record.detail_url}"
        )

    location_node = soup.select_one("p.job-location")
    full_location_text = normalize_whitespace(
        location_node.get_text(" ", strip=True) if location_node else None
    )
    locations = split_locations(full_location_text)
    if not locations and record.location_summary:
        locations = [record.location_summary]

    def detail_text(css_class: str) -> str | None:
        node = soup.select_one(css_class)
        return normalize_whitespace(
            node.get_text(" ", strip=True) if node else None
        )

    apply_node = soup.select_one("a.job-apply[href]")
    apply_url = None
    if isinstance(apply_node, Tag) and isinstance(apply_node.get("href"), str):
        apply_url = canonicalize_url(str(apply_node["href"]), BASE_URL)

    now = datetime.now(timezone.utc)
    return JobPosting(
        firm=record.firm,
        source=record.source,
        source_job_id=record.source_job_id,
        title=record.title,
        service_line=detail_text(".job-detail-category"),
        career_level=detail_text(".job-detail-level") or record.career_level,
        employment_type=detail_text(".job-detail-time-type"),
        locations=locations,
        country="United States",
        detail_url=record.detail_url,
        apply_url=apply_url,
        description=normalize_whitespace(
            description_node.get_text(" ", strip=True)
        ),
        posted_date=None,
        application_deadline=None,
        first_seen_at=now,
        last_seen_at=now,
        status="new",
    )


def posting_from_search(
    record: SearchRecord, *, status: str = "new"
) -> JobPosting:
    now = datetime.now(timezone.utc)
    locations = [record.location_summary] if record.location_summary else []
    return JobPosting(
        firm=record.firm,
        source=record.source,
        source_job_id=record.source_job_id,
        title=record.title,
        service_line=record.service_line,
        career_level=record.career_level,
        employment_type=None,
        locations=locations,
        country=record.country or "United States",
        detail_url=record.detail_url,
        apply_url=None,
        description=None,
        posted_date=None,
        application_deadline=None,
        first_seen_at=now,
        last_seen_at=now,
        status=status,
    )


class PwCConnector(BaseConnector):
    firm_name = "pwc"
    source_name = SOURCE_NAME

    def __init__(self, settings: Settings, logger: Logger) -> None:
        self.search_url = settings.firms["pwc"].search_url
        self.http = SafeHttpClient(
            user_agent=settings.user_agent,
            timeout_seconds=settings.request_timeout_seconds,
            interval_seconds=settings.request_interval_seconds,
            max_retries=settings.max_retries,
            logger=logger,
        )
        self.pages_fetched = 0

    async def close(self) -> None:
        await self.http.close()

    async def fetch_search_records(self) -> list[SearchRecord]:
        first_html = await self.http.get_html(self.search_url)
        self.pages_fetched = 1
        records, total_pages, expected_total = parse_search_page(first_html)
        if not records:
            raise UnexpectedEmptyResultsError(
                "PwC returned no recognizable search results."
            )

        for page in range(2, total_pages + 1):
            html = await self.http.get_html(f"{self.search_url}?p={page}")
            self.pages_fetched += 1
            page_records, _, _ = parse_search_page(html)
            if not page_records:
                raise UnexpectedEmptyResultsError(
                    f"PwC page {page} unexpectedly returned no jobs."
                )
            records.extend(page_records)

        unique = {record.source_job_id: record for record in records}
        if expected_total is not None and len(unique) != expected_total:
            raise UnexpectedEmptyResultsError(
                f"PwC reported {expected_total} jobs, but "
                f"{len(unique)} unique records were parsed."
            )
        return list(unique.values())

    async def fetch_job_detail(self, record: SearchRecord) -> JobPosting:
        html = await self.http.get_html(record.detail_url)
        return parse_job_detail(record, html)
