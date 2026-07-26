from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
import yaml


class FirmSettings(BaseModel):
    enabled: bool = False
    source: str
    search_url: str


class Settings(BaseModel):
    database_path: Path = Path("data/jobs.db")
    output_directory: Path = Path("outputs")
    request_timeout_seconds: float = Field(default=30, gt=0)
    request_interval_seconds: float = Field(default=2, ge=0)
    max_retries: int = Field(default=3, ge=1, le=3)
    user_agent: str
    firms: dict[str, FirmSettings]


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"Configuration file not found: {path}")
    with path.open(encoding="utf-8") as source:
        loaded = yaml.safe_load(source) or {}
    if not isinstance(loaded, dict):
        raise RuntimeError(f"Expected a YAML mapping in {path}")
    return loaded


@lru_cache
def load_settings(config_directory: Path = Path("config")) -> Settings:
    settings_data = _read_yaml(config_directory / "settings.yaml")
    firms_data = _read_yaml(config_directory / "firms.yaml")
    return Settings(**settings_data, firms=firms_data.get("firms", {}))
