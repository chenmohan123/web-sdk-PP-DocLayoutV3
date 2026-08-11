from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def model_contract_path() -> Path:
    return Path(__file__).parents[1] / "artifacts" / "model-contract.json"
