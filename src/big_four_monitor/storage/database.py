from pathlib import Path

from sqlalchemy import Engine, create_engine, event, inspect

from .models import Base


class LegacyDatabaseError(RuntimeError):
    pass


def build_engine(database_path: Path) -> Engine:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{database_path}", future=True)

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    return engine


def init_database(engine: Engine) -> None:
    inspector = inspect(engine)
    if "jobs" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("jobs")}
        if "source_job_id" not in columns:
            raise LegacyDatabaseError(
                "data/jobs.db uses the earlier prototype schema. Move or rename "
                "that file once, then rerun init-db."
            )
    Base.metadata.create_all(engine)
