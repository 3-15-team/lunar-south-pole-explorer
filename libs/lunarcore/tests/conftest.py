import json
from pathlib import Path

import pytest

from lunarcore.ephemeris import default_root

GOLDEN = Path(__file__).resolve().parent / "golden"


def golden(name: str) -> dict:
    return json.loads((GOLDEN / f"{name}.json").read_text())


@pytest.fixture(scope="session")
def eph():
    from lunarcore.ephemeris import Ephemeris

    root = default_root()
    if not (root / "index.json").exists():
        pytest.skip("ephemeris tables not built (just data ephem)")
    return Ephemeris.load(root)
