# AGENTS.md

## Reds rule — implant on sight (standing law, installed 2026-10-26)

Any error or red that surfaces in this repository — CI/Actions failure,
failing test, broken build, runtime defect — is diagnosed and fixed in the
same flow it is seen, with the smallest reversible change, landed through
this repo's normal gate and verified green on the exact head. A seen red is
never parked as a report. Never merge over a blocked mandatory gate or a
red exact head. A credential- or founder-gated red gets a full diagnosis
plus the one unblocking action named — never silence, never a faked fix.
Full charter: `.github/agents/reds-implant.agent.md`.