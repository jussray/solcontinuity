from fastapi.testclient import TestClient

from python.solcontinuity_analytics.app import app
from python.solcontinuity_analytics.scoring import ProviderObservation, score_providers


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
