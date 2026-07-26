from dataclasses import dataclass
from logging import Logger

from ..connectors.base import BaseConnector
from ..connectors.pwc import posting_from_search
from ..filtering.early_career import matches_early_career
from ..storage.repository import JobRepository
from ..utils.retry import BlockedSourceError


@dataclass(frozen=True)
class CrawlResult:
    firm: str
    source: str
    records_found: int
    matching_jobs: int
    new_jobs: int
    updated_jobs: int
    unchanged_jobs: int
    closed_jobs: int
    detail_failures: int
    pages_fetched: int
    dry_run: bool
    run_id: int | None = None


async def run_connector(
    connector: BaseConnector,
    repository: JobRepository,
    logger: Logger,
    *,
    dry_run: bool = False,
) -> CrawlResult:
    run_id = (
        None
        if dry_run
        else repository.begin_run(connector.firm_name, connector.source_name)
    )
    new_jobs = 0
    updated_jobs = 0
    unchanged_jobs = 0
    matching_count = 0
    detail_failures = 0
    seen_ids: set[str] = set()

    try:
        logger.info(
            "Starting %s crawl%s",
            connector.firm_name,
            " (dry run)" if dry_run else "",
        )
        records = await connector.fetch_search_records()
        logger.info(
            "Parsed %d unique %s search records across %d pages",
            len(records),
            connector.firm_name,
            connector.pages_fetched,
        )
        for record in records:
            seen_ids.add(record.source_job_id)
            search_match = matches_early_career(record)
            if search_match.matches:
                matching_count += 1

            needs_detail = (
                search_match.matches
                and (
                    dry_run
                    or repository.needs_detail(record, search_match.matches)
                )
            )
            if needs_detail:
                try:
                    posting = await connector.fetch_job_detail(record)
                except Exception as error:
                    detail_failures += 1
                    logger.warning(
                        "PwC detail fetch failed for %s: %s",
                        record.source_job_id,
                        error,
                    )
                    posting = posting_from_search(record, status="fetch_failed")
            else:
                existing = repository.get_job(record.firm, record.source_job_id)
                if existing is not None and not dry_run:
                    posting = posting_from_search(record, status="active")
                    posting.description = existing.description
                    posting.apply_url = existing.apply_url
                    posting.service_line = (
                        record.service_line or existing.service_line
                    )
                    posting.employment_type = existing.employment_type
                    posting.posted_date = existing.posted_date
                    posting.application_deadline = existing.application_deadline
                    posting.locations = (
                        [location.raw_location for location in existing.locations]
                        or posting.locations
                    )
                    posting.first_seen_at = existing.first_seen_at
                else:
                    posting = posting_from_search(record)

            final_match = matches_early_career(posting).matches
            if dry_run:
                continue

            assert run_id is not None
            result = repository.upsert_job(
                posting, run_id=run_id, is_matching=final_match
            )
            if result.change_type == "new":
                new_jobs += 1
            elif result.change_type == "updated":
                updated_jobs += 1
            else:
                unchanged_jobs += 1

        if dry_run:
            logger.info(
                "Dry run finished: %d matches, %d detail failures",
                matching_count,
                detail_failures,
            )
            return CrawlResult(
                firm=connector.firm_name,
                source=connector.source_name,
                records_found=len(records),
                matching_jobs=matching_count,
                new_jobs=0,
                updated_jobs=0,
                unchanged_jobs=0,
                closed_jobs=0,
                detail_failures=detail_failures,
                pages_fetched=connector.pages_fetched,
                dry_run=True,
            )

        assert run_id is not None
        closed_jobs = repository.complete_run(
            run_id,
            source=connector.source_name,
            seen_job_ids=seen_ids,
            pages_fetched=connector.pages_fetched,
            records_found=len(records),
            matching_jobs=matching_count,
            new_jobs=new_jobs,
            updated_jobs=updated_jobs,
            unchanged_jobs=unchanged_jobs,
            detail_failures=detail_failures,
        )
        logger.info(
            "Crawl run %d succeeded: %d new, %d updated, %d unchanged, %d closed",
            run_id,
            new_jobs,
            updated_jobs,
            unchanged_jobs,
            closed_jobs,
        )
        return CrawlResult(
            firm=connector.firm_name,
            source=connector.source_name,
            records_found=len(records),
            matching_jobs=matching_count,
            new_jobs=new_jobs,
            updated_jobs=updated_jobs,
            unchanged_jobs=unchanged_jobs,
            closed_jobs=closed_jobs,
            detail_failures=detail_failures,
            pages_fetched=connector.pages_fetched,
            dry_run=False,
            run_id=run_id,
        )
    except Exception as error:
        if run_id is not None:
            status = "blocked" if isinstance(error, BlockedSourceError) else "failed"
            repository.fail_run(
                run_id,
                str(error),
                status=status,
                pages_fetched=connector.pages_fetched,
            )
        raise
