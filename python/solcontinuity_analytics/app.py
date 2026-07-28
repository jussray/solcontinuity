from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .scoring import ProviderObservation, score_providers

app = FastAPI(
    title="SolContinuity Analytics",
    version="0.1.0",
    description="Deterministic provider-resilience scoring for Solana dApps.",
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
