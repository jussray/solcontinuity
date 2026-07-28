# Continuity Console design specification

## Product principle

Evidence before decoration. The interface should make provider diversity, disagreement, failure, and recovery status understandable without implying certainty that the evidence cannot support.

## Foundations

- 8-point spacing grid
- minimum 44px interactive targets
- system font stack for the first release
- WCAG AA contrast target
- light and dark themes
- status never encoded by color alone

## Core components

- `EvidenceMetric`: label, value, unit, source, timestamp, confidence
- `ProviderRow`: operator, endpoint alias, latency, health, agreement, last observation
- `FindingCard`: severity, finding, evidence, recommendation, falsifier
- `ProofGate`: state, required evidence, artifact link, owner
- `TruthBoundary`: persistent scope and non-claim callout
- `ManifestEditor`: validated JSON editor with exact issue messages

## Responsive frames

- mobile: 390 × 844
- tablet: 768 × 1024
- desktop: 1440 × 1024

## Prototype path

Overview → Audit lab → Run audit → Inspect finding → Proof gates → Export evidence.
