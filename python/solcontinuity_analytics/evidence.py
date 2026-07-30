from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


@dataclass(frozen=True, slots=True)
class EvidenceAssessment:
    score: int
    verdict: str
    dimensions: dict[str, float]
    flags: tuple[str, ...]
    summary: str


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> Sequence[Any]:
    return value if isinstance(value, list) else ()


def _ratio(value: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return max(0.0, min(1.0, value / total))


def _provider_name_map(artifact: Mapping[str, Any]) -> dict[str, str]:
    providers: dict[str, str] = {}
    for item in _sequence(artifact.get("providerSelection")):
        selection = _mapping(item)
        endpoint_id = selection.get("id")
        provider = selection.get("provider")
        if isinstance(endpoint_id, str) and isinstance(provider, str):
            providers[endpoint_id] = provider.strip().lower()
    return providers


def _independent_provider_count(endpoint_ids: Sequence[Any], names: Mapping[str, str]) -> int:
    providers = {
        names[endpoint_id]
        for endpoint_id in endpoint_ids
        if isinstance(endpoint_id, str) and endpoint_id in names
    }
    return len(providers)


def assess_evidence(artifact: Mapping[str, Any]) -> EvidenceAssessment:
    if not artifact:
        return EvidenceAssessment(
            score=0,
            verdict="missing",
            dimensions={
                "providerHealth": 0.0,
                "quorum": 0.0,
                "routeCoverage": 0.0,
                "broadcastAcceptance": 0.0,
                "independentConfirmation": 0.0,
            },
            flags=("NO_EVIDENCE",),
            summary="No evidence artifact was supplied.",
        )

    flags: list[str] = []
    provider_names = _provider_name_map(artifact)
    provider_total = len(provider_names)

    health = _sequence(artifact.get("health"))
    healthy_endpoint_ids = [
        item.get("endpointId")
        for item in (_mapping(value) for value in health)
        if item.get("healthy") is True
    ]
    provider_health = _ratio(
        _independent_provider_count(healthy_endpoint_ids, provider_names),
        provider_total,
    )

    quorum_read = _mapping(artifact.get("quorumRead"))
    quorum_evidence = _mapping(quorum_read.get("evidence"))
    quorum_provider_count = quorum_evidence.get("providerAgreementCount")
    quorum = _ratio(quorum_provider_count if isinstance(quorum_provider_count, int) else 0, 2)

    transaction = _mapping(artifact.get("transaction"))
    broadcast = _mapping(transaction.get("broadcast"))
    broadcast_evidence = _mapping(broadcast.get("evidence"))
    observations = _sequence(broadcast_evidence.get("observations"))
    attempted_endpoint_ids = [
        item.get("endpointId")
        for item in (_mapping(value) for value in observations)
        if isinstance(item.get("endpointId"), str)
    ]
    route_coverage = _ratio(len(set(attempted_endpoint_ids)), provider_total)

    broadcast_provider_count = broadcast_evidence.get("providerAgreementCount")
    broadcast_acceptance = _ratio(
        broadcast_provider_count if isinstance(broadcast_provider_count, int) else 0,
        1,
    )

    verification = _mapping(transaction.get("verification"))
    confirmed_by = _sequence(verification.get("confirmedBy"))
    independent_confirmation = _ratio(
        _independent_provider_count(confirmed_by, provider_names),
        2,
    )

    status = artifact.get("status")
    if status != "passed":
        flags.append("ARTIFACT_STATUS_FAILED")
    if provider_health < (2 / 3):
        flags.append("LOW_PROVIDER_HEALTH")
    if quorum < 1.0:
        flags.append("QUORUM_UNPROVEN")
    if route_coverage < 1.0:
        flags.append("INCOMPLETE_ROUTE_COVERAGE")
    if broadcast_acceptance < 1.0:
        flags.append("BROADCAST_UNPROVEN")
    if independent_confirmation < 1.0:
        flags.append("CONFIRMATION_QUORUM_UNPROVEN")

    dimensions = {
        "providerHealth": provider_health,
        "quorum": quorum,
        "routeCoverage": route_coverage,
        "broadcastAcceptance": broadcast_acceptance,
        "independentConfirmation": independent_confirmation,
    }
    weighted_score = (
        provider_health * 20
        + quorum * 20
        + route_coverage * 20
        + broadcast_acceptance * 15
        + independent_confirmation * 25
    )
    score = round(weighted_score)

    if status == "passed" and route_coverage == 1.0 and independent_confirmation == 1.0:
        verdict = "verified"
    elif status == "failed":
        verdict = "failed"
    else:
        verdict = "incomplete"

    summary = (
        f"{verdict.title()} evidence: score {score}/100, "
        f"{_independent_provider_count(confirmed_by, provider_names)} independent confirmation provider(s), "
        f"{len(set(attempted_endpoint_ids))}/{provider_total} configured routes attempted."
    )

    return EvidenceAssessment(
        score=score,
        verdict=verdict,
        dimensions=dimensions,
        flags=tuple(flags),
        summary=summary,
    )
