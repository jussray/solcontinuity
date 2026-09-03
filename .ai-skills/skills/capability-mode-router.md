# Capability Mode Router — Portable AI Skill File

> Use as a cross-agent operating skill. It may be loaded into ChatGPT/Work, Codex, Claude, Perplexity, Founder Control Room, Chief, or another compatible agent surface. Runtime availability must always be re-observed.

## When to Use

Use when switching reasoning modes, selecting among overlapping AI/tool capabilities, crossing providers, or deciding whether a native/connected capability should replace a manual workaround.

## Commands

### /redteam — Adversarial Testing Mode
Attack the code/plan. Find 3 failure points. List edge cases not handled. Propose specific attacks (malformed input, empty states, concurrent access, resource exhaustion). Rate each: Critical/High/Medium/Low. End with the single top fix priority.

### /lindy — Proven Technology Mode
Prefer solutions with longer proven track records. Standard library > third-party packages when capability is equivalent. Flag immature dependencies when they materially increase risk. If two solutions are equally capable, choose the older, simpler, more reversible one.

### /ooda — Decision Loop Mode
Structure work through:
- Observe: current state, exact source of truth, what changed
- Orient: constraints and root cause
- Decide: one reversible action
- Act: execute, verify, feed evidence back into Observe

### /human — Humanized Output Mode
Use natural, direct language. Avoid filler and canned enthusiasm. Match the user's energy while keeping technical claims precise.

### /confess — Honest Limitation Mode
State material limitations and unknowns. Label guesses. Say "I don't know" when evidence does not support a conclusion, then use an available evidence-gathering capability when appropriate.

### /truth — Truth Mode
Prefer verified reality over agreement. Do not convert stale state, plan text, connector presence, or prior success into a current claim.

### /ultrathink — Deep Reasoning Mode
For complex architecture, debugging, security, or multi-system work:
1. Restate the exact goal
2. Pin authority and current state
3. Identify constraints
4. Compare the smallest viable approaches
5. Select one reversible action
6. Execute
7. Verify against the real path
8. Attack the conclusion before calling it done

### /artifact — Working Deliverable Mode
End with a usable artifact, executed change, passing/failing test, or one exact next gate. Do not substitute prose for a requested implementation.

## Mode Stacking

| Stack | Use Case |
|---|---|
| /ultrathink /redteam | Deep security analysis before deployment |
| /lindy /artifact | Ship a proven-tech solution as working code |
| /ooda /confess | Honest project-state assessment and next action |
| /truth /human | Direct natural feedback without padding |
| /lindy /ooda /artifact | Proven incremental build loop |
| /redteam /truth /artifact | Adversarial review with a focused repair |

## Portable Capability Routing Contract

Executable reference implementation:

- `.ai-skills/runtime/capability-routing.mjs`
- `.ai-skills/runtime/capability-routing.test.mjs`
- contract: `juss/portable-capability-routing@v1`
- continuity cookie: `juss/portable-capability-continuity@v1`

### Selection rule

Use the **strongest eligible available capability declared by policy**, not the fanciest tool and not a fixed vendor ranking.

A candidate is eligible only when all are true:

1. it is currently available;
2. it is currently permitted;
3. it satisfies every required capability class;
4. its authority ceiling does not exceed the current task authority;
5. its provider/runtime identity can be observed;
6. required evidence and verification boundaries remain satisfiable.

When a native or connected capability materially improves correctness, evidence quality, or execution, prefer it over a manual workaround. A manual path may be used only as an explicit lower-priority fallback, never as a silent substitute.

Examples of capability classes:

- `repository.read`
- `repository.write`
- `files.read`
- `files.write`
- `web.research`
- `deep-research`
- `connector.read`
- `connector.write`
- `workspace.execute`
- `code.execute`
- `browser.verify`
- `image.generate`
- `automation.schedule`
- `automation.condition`
- `provider.read`
- `provider.write`

Providers and product names are implementations of capability classes. They do not become constitutional authority.

### Runtime discovery

Never assume a plan tier, model, plugin, connector, workspace, browser, provider, or coding agent is currently available because documentation, memory, or a previous run said it was.

Re-observe runtime availability before load-bearing use.

Examples of implementation surfaces that may satisfy capability classes when actually available include:

- conversation files / library files;
- current web or deep-research tools;
- connected apps and provider connectors;
- a persistent work/execution workspace;
- a coding agent/runtime;
- image generation;
- scheduled or conditional automation;
- repository-native CI and browser verification.

These are examples, not a hard-coded ranking.

### No fallback laundering

Do not say a task was completed with an advanced/native capability if the runtime actually fell back to manual copy/paste, prose instructions, simulated output, stale cached state, or an unrelated tool.

A fallback must record why the preferred route was unavailable or ineligible.

## Fingerprints

Every load-bearing route can be bound with `capabilityRouteFingerprint()`.

The fingerprint includes:

- project identity;
- repository identity;
- target ref and exact SHA when applicable;
- task class;
- required capability classes;
- selected capability classes;
- implementation identity;
- provider identity;
- runtime identity and version;
- availability fingerprint;
- permission fingerprint;
- evidence fingerprint;
- authority fingerprint;
- verification fingerprint.

If any load-bearing dimension moves, the fingerprint moves.

Use `capabilityDimensionFingerprint()` to hash provider/runtime/permission/evidence observations without retaining raw secrets or large payloads.

A fingerprint is evidence of state identity only. It is never approval.

## Continuity Cookies

Use `createCapabilityContinuityCookie()` for durable handoff metadata between agents, sessions, or project surfaces.

This is a **continuity cookie**, not a browser authentication cookie.

The executable contract fixes:

```text
browserCookie = false
authorizing = false
approvalCarryForward = false
standingMutationAuthority = false
founderDecisionRequiredForPrivilegedMutation = true
```

A continuity cookie binds the route fingerprint plus observation time, expiry, predecessor fingerprint, and bounded evidence references.

`evaluateCapabilityContinuityCookie()` marks continuity stale or invalid when the project, repository, target, task class, capability route, implementation, provider, runtime, availability, permissions, evidence, authority, verification state, or expiry moves.

Reacquisition creates a new continuity observation. It does not renew an old approval.

Do not place secrets, raw access tokens, private content, or browser session values in continuity cookies.

## Authority Boundary

Availability is not permission.
Permission is not founder approval.
A fingerprint is not founder approval.
A continuity cookie is not founder approval.
A passing test is not production truth.
A connector installation is not mutation authority.

Use one execution owner for each atomic mutation. Preserve provider-specific approval, billing, deletion, publishing, credential, production, and destructive-action gates.

For Founder Control Room workflows, FCR remains the authority/evidence membrane. Chief or another designated planner may select capability composition, but no runtime may enlarge the plan's authority ceiling merely because it has a more powerful tool.

## Verification

Use the cheapest valid proof first, then escalate:

1. contract/input validation;
2. focused unit test;
3. typecheck/lint for touched code;
4. targeted integration test;
5. Playwright/device proof for changed UI or browser runtime;
6. exact-head CI/provider/runtime evidence when required.

Never hide a red signal with mocks, silent fallback, broad retries, or a lower-quality proof path.

## Cross-Tool Relay

Do not route by a permanent vendor slogan such as "research always goes to X" or "build always goes to Y."

Instead:

```text
goal
→ required capability classes
→ current availability + permission discovery
→ authority ceiling
→ strongest eligible route
→ capability fingerprint
→ continuity cookie
→ execute
→ verify
→ new fingerprint when reality moves
```

GitHub or another shared repository may carry durable source state, but repository state does not replace provider/runtime readback.

## Definition of Done

Capability routing is complete only when:

- the required capability classes are explicit;
- the selected implementation is currently available and permitted;
- no higher-priority eligible route was silently ignored;
- the route stays within the authority ceiling;
- load-bearing state is fingerprinted;
- cross-agent continuity is carried only by non-authorizing continuity cookies;
- required verification is complete;
- stale evidence or a route change triggers reacquisition;
- no provider or AI product has become permanent authority merely because it was convenient.
