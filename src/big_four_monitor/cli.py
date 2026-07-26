import argparse
import asyncio
from pathlib import Path
import sys

from sqlalchemy import create_engine

from .connectors.pwc import PwCConnector
from .services.crawler import CrawlResult, run_connector
from .services.exporter import export_outputs
from .settings import Settings, load_settings
from .storage.database import LegacyDatabaseError, build_engine, init_database
from .storage.repository import JobRepository
from .utils.logging import configure_logging


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m big_four_monitor",
        description="Deterministic local monitor for official Big Four US jobs.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-db", help="Initialize data/jobs.db.")

    investigate = commands.add_parser(
        "investigate", help="Show the documented source investigation."
    )
    investigate.add_argument("--firm", choices=("pwc",), required=True)

    crawl = commands.add_parser("crawl", help="Retrieve and store job records.")
    crawl.add_argument("--firm", choices=("pwc", "all"), required=True)
    crawl.add_argument(
        "--dry-run",
        action="store_true",
        help="Retrieve and parse without changing the database or outputs.",
    )

    commands.add_parser("status", help="Summarize the local database.")
    commands.add_parser("export", help="Regenerate outputs from the latest run.")
    commands.add_parser(
        "notify", help="Regenerate the local HTML notification preview."
    )
    return parser


def _repository(settings: Settings, *, memory: bool = False) -> JobRepository:
    engine = (
        create_engine("sqlite+pysqlite:///:memory:")
        if memory
        else build_engine(settings.database_path)
    )
    init_database(engine)
    return JobRepository(engine)


def _print_result(result: CrawlResult) -> None:
    prefix = "Dry run" if result.dry_run else "Crawl"
    print(
        f"{prefix} complete for {result.firm}: "
        f"{result.records_found} records, "
        f"{result.matching_jobs} early-career matches, "
        f"{result.new_jobs} new, {result.updated_jobs} updated, "
        f"{result.unchanged_jobs} unchanged, {result.closed_jobs} closed, "
        f"{result.detail_failures} detail failures, "
        f"{result.pages_fetched} search pages."
    )
    if result.dry_run:
        print("No database, output, or email state was changed.")


async def _crawl(settings: Settings, firm: str, dry_run: bool) -> int:
    repository = _repository(settings, memory=dry_run)
    logger = configure_logging(
        None
        if dry_run
        else settings.output_directory / "job_monitor.log"
    )
    firms = ["pwc"] if firm in {"pwc", "all"} else []
    failures = 0
    for firm_name in firms:
        connector = PwCConnector(settings, logger)
        try:
            result = await run_connector(
                connector, repository, logger, dry_run=dry_run
            )
            _print_result(result)
            if not dry_run:
                summary = export_outputs(
                    repository, settings.output_directory
                )
                print(
                    f"Generated local outputs for run #{summary['run_id']} "
                    f"in {settings.output_directory}."
                )
                print("Email delivery is disabled; preview only.")
        except Exception as error:
            failures += 1
            logger.error("%s connector failed: %s", firm_name, error)
        finally:
            await connector.close()
    if firm == "all":
        print("KPMG, EY, and Deloitte connectors are deferred in MVP0.")
    return 1 if failures else 0


def _print_status(repository: JobRepository, database_path: Path) -> None:
    summary = repository.status_summary()
    print(f"Database: {database_path}")
    print(
        f"Jobs: {summary['total_jobs']} stored, "
        f"{summary['matching_active_jobs']} active early-career matches, "
        f"{summary['closed_jobs']} closed"
    )
    print(f"Crawl runs: {summary['total_runs']}")
    latest = summary["latest_run"]
    if latest:
        print(
            f"Latest run #{latest.id}: {latest.status}; "
            f"{latest.records_found} records, {latest.new_jobs} new, "
            f"{latest.updated_jobs} updated, "
            f"{latest.unchanged_jobs} unchanged"
        )
        if latest.error_message:
            print(f"Latest error: {latest.error_message}")
    else:
        print("No crawl has run yet.")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = load_settings()
        if args.command == "init-db":
            _repository(settings)
            print(f"Initialized SQLite database at {settings.database_path}")
            return 0
        if args.command == "investigate":
            print("PwC source investigation: docs/data-source-investigation.md")
            print(f"Search URL: {settings.firms['pwc'].search_url}")
            print("Source type: public server-rendered HTML")
            print("Pagination: ?p=<page number>")
            print("No login, JavaScript, or pre-existing cookie is required.")
            return 0
        if args.command == "crawl":
            return asyncio.run(_crawl(settings, args.firm, args.dry_run))
        repository = _repository(settings)
        if args.command == "status":
            _print_status(repository, settings.database_path)
            return 0
        if args.command in {"export", "notify"}:
            summary = export_outputs(repository, settings.output_directory)
            action = "Exported files" if args.command == "export" else "Updated preview"
            logger = configure_logging(
                settings.output_directory / "job_monitor.log"
            )
            logger.info(
                "%s for successful crawl run %s; email delivery disabled",
                action,
                summary["run_id"],
            )
            print(
                f"{action} for run #{summary['run_id']} in "
                f"{settings.output_directory}."
            )
            print("No email was sent.")
            return 0
    except (RuntimeError, OSError, LegacyDatabaseError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0
