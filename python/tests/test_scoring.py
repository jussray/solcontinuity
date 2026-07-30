import json
from pathlib import Path

from fastapi.testclient import TestClient

from python.solcontinuity_analytics.app import app
from python.solcontinuity_analytics.evidence import assess_evidence
from python.solcontinuity_analytics.scoring import ProviderObservation, score_providers


SAMPLE_PATH = Path("examples/evidence/live-devnet-evidence.sample.json")


def sample_artifact() -> dict[str, object]:
    return json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))


def test_independent_healthy_providers_score_high() -> None:
    result = score_providers(
        [
            ProviderObservation("a", "operator-a", True, 120, True),
            ProviderObservation("b", "operator-b", True, 180, True),
            ProviderObservation("c", "operator-c", True, 260, True),
        ]
    )

    assert result.score >= 90
    assert result.flags == ()


def test_multiple_urls_from_one_operator_are_flagged() -> None:
    result = score_providers(
        [
            ProviderObservation("a", "same-operator", True, 100, True),
            ProviderObservation("b", "same-operator", True, 110, True),
            ProviderObservation("c", "same-operator", True, 120, True),
        ]
    )

    assert "OPERATOR_CONCENTRATION" in result.flags
    assert result.operator_diversity == 0.5


def test_api_returns_truth_boundary() -> None:
    client = TestClient(app)
    response = client.post(
        "/score",
        json={
            "observations": [
                {
                    "endpoint_id": "a",
                    "operator": "operator-a",
                    "healthy": True,
                    "latency_ms": 100,
                    "agrees_with_majority": True,
                },
                {
                    "endpoint_id": "b",
                    "operator": "operator-b",
                    "healthy": True,
                    "latency_ms": 150,
                    "agrees_with_majority": True,
                },
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["score"] >= 90
    assert "does not prove" in payload["truthBoundary"]


def test_passed_live_artifact_is_verified() -> None:
    result = assess_evidence(sample_artifact())

    assert result.verdict == "verified"
    assert result.score >= 90
    assert result.dimensions["routeCoverage"] == 1.0
    assert result.dimensions["independentConfirmation"] == 1.0


def test_evidence_api_returns_score_and_truth_boundary() -> None:
    client = TestClient(app)
    response = client.post("/evidence/score", json={"artifact": sample_artifact()})

    assert response.status_code == 200
    payload = response.json()
    assert payload["verdict"] == "verified"
    assert payload["score"] >= 90
    assert "does not prove" in payload["truthBoundary"]
