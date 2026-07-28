from __future__ import annotations

from dataclasses import dataclass
from statistics import quantiles
from typing import Iterable


@dataclass(frozen=True, slots=True)
class ProviderObservation:
    endpoint_id: str
    operator: str
    healthy: bool
    latency_ms: float
    agrees_with_majority: bool


@dataclass(frozen=True, slots=True)
class ResilienceScore:
    score: int
    availability: float
    operator_diversity: float
    latency: float
    agreement: float
    flags: tuple[str, ...]


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _p95(values: list[float]) -> float:
    if not values:
        return 10_000.0
    if len(values) == 1:
        return values[0]
    return quantiles(values, n=20, method="inclusive")[18]


def score_providers(
    observations: Iterable[ProviderObservation],
    *,
    latency_budget_ms: float = 1_500.0,
    minimum_independent_operators: int = 2,
) -> ResilienceScore:
    items = tuple(observations)
    if not items:
        return ResilienceScore(
            score=0,
            availability=0.0,
            operator_diversity=0.0,
            latency=0.0,
            agreement=0.0,
            flags=("NO_PROVIDER_EVIDENCE",),
        )

    healthy = tuple(item for item in items if item.healthy)
    availability = len(healthy) / len(items)
    operators = {item.operator.strip().casefold() for item in healthy if item.operator.strip()}
    operator_diversity = _clamp(len(operators) / max(minimum_independent_operators, 1))
    latency = _clamp(1 - (_p95([item.latency_ms for item in healthy]) / latency_budget_ms))
    agreement = (
        sum(1 for item in healthy if item.agrees_with_majority) / len(healthy)
        if healthy
        else 0.0
    )

    weighted = (
        availability * 0.40
        + operator_diversity * 0.30
        + latency * 0.15
        + agreement * 0.15
    )

    flags: list[str] = []
    if availability < 0.67:
        flags.append("LOW_AVAILABILITY")
    if len(operators) < minimum_independent_operators:
        flags.append("OPERATOR_CONCENTRATION")
    if latency < 0.35:
        flags.append("HIGH_P95_LATENCY")
    if agreement < 0.67:
        flags.append("RESPONSE_DISAGREEMENT")

    return ResilienceScore(
        score=round(weighted * 100),
        availability=round(availability, 4),
        operator_diversity=round(operator_diversity, 4),
        latency=round(latency, 4),
        agreement=round(agreement, 4),
        flags=tuple(flags),
    )
