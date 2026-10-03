# Social Analytics Continuity Adapter v1

## Role

Sol preserves continuity for social experiments. It does not own provider truth, strategy authority, or publishing authority.

FCR owns the canonical observation/evidence record. Chief owns the bounded decision. PromptOS owns prompt/routing behavior. Sol binds the exact experiment state across sessions and runs so stale evidence cannot masquerade as current proof.

## Continuity identity

A social experiment continuity marker should bind, when available:

- platform;
- account identity;
- control identity;
- challenger identity;
- campaign/experiment id;
- observation-window kind;
- window start/end;
- primary metric;
- FCR observation/evidence fingerprint;
- Chief decision fingerprint;
- current gate state;
- predecessor cookie/fingerprint.

These markers are non-secret state markers, never credentials or authority tokens.

## Invalidation rules

Mark predecessor social proof stale and reobserve when any material bound changes, including:

- account identity;
- post/content identity;
- provider/source;
- time window or window kind;
- metric definition;
- primary success metric;
- control/challenger definition;
- relevant product/content gate;
- FCR evidence fingerprint;
- Chief decision subject.

A previous 30-day read cannot be silently reused as a calendar-month read. An account-level receipt cannot become a post-level receipt. A result from one Instagram account cannot roll forward to another account.

## Current Instagram cookie

The current bounded experiment state is:

- control: personal/family video;
- challenger: personal/founder hybrid video;
- founder-only: unproven hypothesis;
- JBH: existing image-quality and approved cadence gates remain external constraints;
- primary outcome: compatible provider-native performance plus downstream qualified actions when available.

Do not mark a winner until Chief issues a bounded decision from fresh FCR evidence.

## Outgoing state

After a valid measurement/decision cycle, emit a refreshed continuity marker that references the exact FCR receipt and Chief decision. If evidence is missing, conflicting, or stale, preserve `UNKNOWN`, `BLOCKED`, or stale rather than carrying a prior green state forward.

## Authority ceiling

Continuity fingerprints/cookies prove state lineage only. They cannot publish, schedule, change content, declare performance truth, spend, merge, deploy, or override product-specific gates.
