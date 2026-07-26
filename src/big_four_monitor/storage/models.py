from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class JobRow(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("firm", "source_job_id", name="uq_jobs_firm_source_job"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    firm: Mapped[str] = mapped_column(String(50), index=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    source_job_id: Mapped[str] = mapped_column(String(150))
    title: Mapped[str] = mapped_column(String(500))
    service_line: Mapped[str | None] = mapped_column(String(250))
    career_level: Mapped[str | None] = mapped_column(String(150))
    employment_type: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    location_summary: Mapped[str | None] = mapped_column(Text)
    detail_url: Mapped[str] = mapped_column(Text)
    apply_url: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    posted_date: Mapped[str | None] = mapped_column(String(50))
    application_deadline: Mapped[str | None] = mapped_column(String(100))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(30), index=True)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    missing_run_count: Mapped[int] = mapped_column(Integer, default=0)
    is_matching: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    locations: Mapped[list["JobLocationRow"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class JobLocationRow(Base):
    __tablename__ = "job_locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    city: Mapped[str | None] = mapped_column(String(150))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    raw_location: Mapped[str] = mapped_column(Text)

    job: Mapped[JobRow] = relationship(back_populates="locations")


class CrawlRunRow(Base):
    __tablename__ = "crawl_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    firm: Mapped[str] = mapped_column(String(50), index=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(30), index=True)
    pages_fetched: Mapped[int] = mapped_column(Integer, default=0)
    records_found: Mapped[int] = mapped_column(Integer, default=0)
    matching_jobs: Mapped[int] = mapped_column(Integer, default=0)
    new_jobs: Mapped[int] = mapped_column(Integer, default=0)
    updated_jobs: Mapped[int] = mapped_column(Integer, default=0)
    unchanged_jobs: Mapped[int] = mapped_column(Integer, default=0)
    closed_jobs: Mapped[int] = mapped_column(Integer, default=0)
    detail_failures: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)


class RunJobChangeRow(Base):
    __tablename__ = "run_job_changes"
    __table_args__ = (
        UniqueConstraint("run_id", "job_id", name="uq_run_job_change"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("crawl_runs.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    change_type: Mapped[str] = mapped_column(String(30), index=True)
    is_matching: Mapped[bool] = mapped_column(Boolean, default=False)
