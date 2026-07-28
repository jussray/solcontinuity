# Production Webapp Build Skill

## Mission

Turn a product goal into a focused, production-shaped web experience that proves the real workflow. Do not build a decorative demo that collapses under inspection.

## Before coding

State:

- authoritative repository and branch
- target user and job to be done
- exact route or screen
- data source and state ownership
- files needed first
- proof path
- stop condition
- rollback

## Product rules

- Start with a visible user outcome, not framework selection.
- Use semantic HTML and accessible controls.
- Design for mobile down to 320 CSS pixels.
- Keep application state explicit and testable.
- Handle loading, empty, invalid, partial, and failed states.
- Never hide errors to make the interface appear green.
- Use gradients only to establish hierarchy or atmosphere, never to bury legibility.
- Keep dashboards decision-oriented. Every metric must answer what changed, why it matters, or what action follows.
- Include onboarding only when it shortens time to first value.
- Demonstrate relevant technical skills naturally. Do not bolt in frameworks or protocols as résumé confetti.
- Add thoughtful comments only where intent, security, or non-obvious tradeoffs need preservation.

## 80/20 workflow

1. Build one complete path.
2. Verify the browser path with Playwright.
3. Test the failure state.
4. Preserve screenshots or traces.
5. Add secondary surfaces only after the primary path is green.

## Required proof

- strict typecheck
- focused unit or integration tests
- Playwright path for visible behavior
- screenshot or trace artifact
- truth boundary stating what remains unverified

## Required report

```text
REALITY:
FIX:
PROOF:
RISK:
ROLLBACK:
NEXT GATE:
```
