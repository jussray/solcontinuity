# SolContinuity Operating Contract

Use this file as the project-level prompt contract for coding agents.

## Authority

Default authority is **PREPARE**. Inspect, design, draft, test locally, and report. Do not publish, spend, submit, deploy, merge, rotate secrets, or delete user-owned material without an explicit founder decision.

## Command stack

### /goal

Define one measurable finish line and stop condition.

**Template**

```text
/goal
Outcome: [single user-visible or technical result]
Source of truth: [repo, branch, issue, logs]
Done when: [tests, browser path, evidence]
Not included: [explicit exclusions]
Rollback: [exact reversal]
```

### /plan

Before a broad change, list the exact files, why each must change, verification order, and rollback. Prefer one focused patch.

### /compact

Compress context into:

- authoritative repo and branch
- goal and stop condition
- verified reality
- current hypothesis
- files touched
- proof collected
- unresolved risk
- next gate

Never compress away founder constraints, deletion rules, secrets rules, or failed evidence.

### /btw

Answer a side question without changing the active goal, scope, or source-of-truth assumptions.

### /resume

Recover the latest verified state from commits, tests, logs, and artifacts. Never treat an old summary as fresher than the repo.

### /loop

Use only for a real future condition. A loop monitors; it does not manufacture progress or hide a blocked task.

### /effort

- low: mechanical formatting or boilerplate
- medium: localized code changes with known patterns
- high: architecture, security, concurrency, money movement, keys, or public claims

### /caveman

Explain the design with plain nouns and verbs. Remove jargon until the causal path is obvious.

### /v10

Return exactly three decisions that materially change the path. Each includes why, proof, risk, authority, and next gate.

### /insights

Extract reusable lessons only after evidence exists. Do not convert guesses into doctrine.

### /ultrathink

Generate competing explanations and implementations. Red-team each. Keep the smallest option that survives and can be reversed.

## Reasoning lenses

### /Hormozi

Clarify the painful problem, dream outcome, time delay, effort burden, and proof. Do not inflate claims. Translate technical resilience into developer value:

- fewer outage-induced failures
- faster diagnosis
- lower provider lock-in
- portable recovery
- evidence for users and grant reviewers

### /unlearn

List assumptions inherited from ordinary web apps that should be questioned, such as one backend, one RPC, one hosted frontend, and one source of truth.

### /human

Write UI and documentation for a tired developer under pressure. Show the failure, surviving path, evidence, and exact next action. Avoid crypto theater.

### /truthmode

Separate VERIFIED, INFERRED, UNKNOWN, BLOCKED, and RECOMMENDED. State what would falsify risky claims.

### 80/20

Build one complete proof path before adding provider catalogs, reputation systems, governance, analytics, or token incentives.

### FutureYOU

Score work by bottleneck relief, reuse, evidence gain, founder control, durability, risk reduction, and time-to-proof.

### Antiadvice

Before accepting conventional advice, ask whose incentives it serves, what evidence supports it, and what breaks if we do the opposite.

### First principles

Reduce the system to:

1. a user needs to read state
2. a user needs to submit a signed transaction
3. infrastructure can fail or filter
4. independent routes and verification reduce dependence
5. evidence must remain portable

### YCOMBINATOR

Identify one sharp user: a small Solana team whose dApp silently depends on one RPC and one hosted frontend. Build something they can install and test in one afternoon.

### SOCRATES

Ask:

- What exactly is being claimed?
- What evidence would prove it?
- What centralized assumption remains?
- Can another team reproduce the result?
- What is the smallest counterexample?

## Required report

```text
REALITY:

FIX:

PROOF:

RISK:

ROLLBACK:

NEXT GATE:
```
