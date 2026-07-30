from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .evidence import assess_evidence
from .scoring import ProviderObservation, score_providers

app = FastAPI(
    title="SolContinuity Analytics",
    version="0.2.0",
    description="Deterministic provider and blockchain-evidence scoring for Solana dApps.",
)


class ProviderSample(BaseModel):
    endpoint_id: str = Field(min_length=1)
    operator: str = Field(min_length=1)
    healthy: bool
    latency_ms: float = Field(ge=0)
    agrees_with_majority: bool


class ScoreRequest(BaseModel):
    observations: list[ProviderSample]
    latency_budget_ms: float = Field(default=1_500.0, gt=0)
    minimum_independent_operators: int = Field(default=2, ge=1)


class EvidenceScoreRequest(BaseModel):
    artifact: dict[str, Any]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "solcontinuity-analytics", "status": "ok"}


@app.post("/score")
def score(request: ScoreRequest) -> dict[str, object]:
    result = score_providers(
        (
            ProviderObservation(
                endpoint_id=item.endpoint_id,
                operator=item.operator,
                healthy=item.healthy,
                latency_ms=item.latency_ms,
                agrees_with_majority=item.agrees_with_majority,
            )
            for item in request.observations
        ),
        latency_budget_ms=request.latency_budget_ms,
        minimum_independent_operators=request.minimum_independent_operators,
    )
    return {
        "score": result.score,
        "dimensions": {
            "availability": result.availability,
            "operatorDiversity": result.operator_diversity,
            "latency": result.latency,
            "agreement": result.agreement,
        },
        "flags": list(result.flags),
        "truthBoundary": "This score summarizes supplied observations; it does not prove a provider is honest or a dApp is uncensorable.",
    }


@app.post("/evidence/score")
def score_evidence(request: EvidenceScoreRequest) -> dict[str, object]:
    report = asdict(assess_evidence(request.artifact))
    report["truthBoundary"] = (
        "This score evaluates only the supplied application-layer evidence. "
        "It does not prove RPC operator honesty, prevent collusion, or guarantee inclusion."
    )
    return report
