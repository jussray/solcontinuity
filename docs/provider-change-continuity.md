# Provider Change Evidence Continuity

SolContinuity can validate a structured FCR provider-change receipt for source identity, official HTTPS host, deterministic fingerprint, duplicate state, and age. The exported validator is an evidence-quality utility; it does not fetch provider pages, prove the source text is truthful, or deliver events between applications.

A fresh event means its receipt is structurally valid and its observation is no older than two hours. It does not mean the capability remains available to a particular account. Duplicate receipts remain duplicates even if re-observed. Stale or invalid evidence must not be presented as current. A caller must preserve source-coverage failures as unknown/incomplete, not convert them into a no-change result.

The current FCR monitor is hourly polling. Provider product announcements do not have a supported cross-provider launch webhook in this design. Do not describe the system as instant or event-driven until an authenticated source-to-FCR delivery path and recipient readback are implemented and verified.
