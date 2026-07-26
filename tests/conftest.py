from pathlib import Path

import pytest


@pytest.fixture
def fixture_directory() -> Path:
    return Path(__file__).parent / "fixtures" / "pwc"
