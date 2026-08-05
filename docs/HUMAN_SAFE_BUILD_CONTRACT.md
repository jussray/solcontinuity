# Human-Safe Build Contract

SolContinuity is built for the human reviewing continuity, evidence, recovery, and system state.

## Core rule

A user-facing dashboard, command result, evidence view, recovery workflow, or status surface must not resolve to silence when the system knows enough to show a state.

Do not use `return null` for loading, error, empty, denied, offline, unavailable, recovery, or transitional states that can block understanding or action.

## Required human-facing states

Every continuity workflow must provide the applicable state with clear language and an honest next action:

- loading or checking;
- success;
- empty;
- denied or permission-limited;
- offline or degraded;
- error;
- blocked with the missing evidence;
- recovery, retry, back, rollback, or safe exit.

Never imply continuity, evidence, recovery, or provider success when proof is missing.

## Where `null` remains valid

`null` may remain in evidence, parser, API, provider, storage, manifest, cache, and optional-value contracts when it explicitly means `not found`, `not configured`, `unknown`, or `not applicable`.

That contract must be typed or tested. A human-facing caller must translate meaningful absence into a visible state whenever it affects comprehension, trust, recovery, or the next action.

Optional decorative elements may render nothing only when their absence cannot hide progress, failure, denial, evidence, or a required action.

## Safe implementation loop

### Observe

Inspect the active caller, dashboard, exact branch head, evidence source, tests, and rendered behavior. Distinguish a valid unknown sentinel from a blank-state defect.

### Orient

Red-team stale evidence, unavailable RPCs, missing manifests, partial history, denied access, network loss, malformed responses, and narrow/mobile layouts.

### Decide

Choose the smallest proven repair. Prefer platform primitives and existing components. Avoid new dependencies when standard TypeScript, JavaScript, browser, or Node.js behavior is sufficient.

### Act

Render the missing state, preserve evidence and authority boundaries, add a focused regression test, and run exact-head proof.

## Proof requirements

- Unit or source-contract proof for the state decision.
- Type, test, and build proof where applicable.
- Playwright proof for changed rendered dashboard behavior.
- Exact-head CI evidence before merge.

A screenshot, design mock, or unrelated green workflow is not runtime or continuity proof.

## Red-team constraints

Never replace `null` mechanically across a repository. Blind replacement can invent evidence, conceal provider failure, weaken denied states, or create false recovery confidence.

Never show success when the underlying continuity or evidence state is unknown or failed.

## Definition of done

The human can tell:

1. what the system is doing;
2. what happened;
3. which evidence is present or missing;
4. what they can do next;
5. how to recover or roll back when possible.

Build the smallest safe thing, prove it at the exact head, and leave no human staring into an empty frame.
