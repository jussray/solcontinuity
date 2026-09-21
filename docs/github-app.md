# Sol Continuity GitHub App

Sol Continuity can run as an installable GitHub App that audits continuity manifests on exact pull-request and push heads and publishes the result as a GitHub Check Run.

The GitHub App adapter is intentionally bounded. It reads repository contents, runs the existing Sol Continuity manifest parser and audit engine, and writes a check result. It does not receive repository-content write authority, merge authority, wallet/private-key authority, transaction-signing authority, or financial/value-transfer authority.

## GitHub App registration

Create a GitHub App owned by the account or organization that should distribute Sol Continuity.

Recommended repository permissions:

- **Contents: Read-only** — read the continuity manifest at the exact commit being evaluated.
- **Pull requests: Read-only** — receive pull-request webhook events.
- **Checks: Read and write** — publish the `Sol Continuity` check run.
- **Metadata: Read-only** — GitHub grants this baseline repository metadata permission automatically.

Subscribe to these events:

- **Pull request**
- **Push**

The runtime intentionally ignores other events.

Set the GitHub App webhook URL to the public HTTPS deployment route:

```text
https://YOUR_HOST/github/webhook
```

Generate a high-entropy webhook secret and configure the same value in the deployment environment. GitHub signs webhook deliveries with `X-Hub-Signature-256`; the runtime verifies that signature against the raw request body before parsing the event.

Generate a private key for the GitHub App. The runtime uses it only to mint the short-lived GitHub App JWT required to exchange for an installation access token. The private key must be stored as a deployment secret and must never be committed.

## Runtime environment

Required:

```text
SOLCONTINUITY_GITHUB_APP_ID=<github-app-id>
SOLCONTINUITY_GITHUB_PRIVATE_KEY=<github-app-private-key-pem>
SOLCONTINUITY_GITHUB_WEBHOOK_SECRET=<high-entropy-webhook-secret>
```

Optional:

```text
PORT=4174
SOLCONTINUITY_GITHUB_API_URL=https://api.github.com
SOLCONTINUITY_GITHUB_MANIFEST_PATHS=.solcontinuity/manifest.json,solcontinuity.manifest.json,continuity-manifest.json
```

`SOLCONTINUITY_GITHUB_API_URL` exists for GitHub Enterprise or deterministic test doubles. The default is `https://api.github.com`.

Start the app:

```bash
npm run start:github-app
```

Health endpoint:

```text
GET /health
```

Webhook endpoint:

```text
POST /github/webhook
```

## Manifest discovery

At each supported event, Sol Continuity binds the audit to the event's exact head SHA and searches, in order:

1. `.solcontinuity/manifest.json`
2. `solcontinuity.manifest.json`
3. `continuity-manifest.json`

Override that list with `SOLCONTINUITY_GITHUB_MANIFEST_PATHS` when a repository has a different convention.

If no manifest exists, the App publishes a **neutral** check rather than pretending the repository passed. If the manifest cannot be validated, the App publishes a **failure** check. A valid audit fails when it contains a `critical` or `high` continuity finding and succeeds otherwise.

## Evidence and proof cookies

Each check binds:

- webhook delivery ID;
- webhook event type;
- repository full name;
- exact head SHA;
- manifest path;
- audit score when one exists.

Those values are hashed into a short evidence-only proof cookie (`sol-gh-...`) included in the Check Run summary. The cookie is not authentication, authorization, signing authority, or a secret.

The webhook server also keeps a bounded in-memory delivery-ID cache to suppress immediate replay of the same delivery. This is process-local replay resistance, not durable deduplication across restarts or replicas. A production multi-replica deployment should move delivery deduplication to a shared durable store before claiming cross-instance exactly-once behavior.

## Authority boundary

The GitHub App integration inherits `REPAIR_AUTHORITY.md`.

It is allowed to:

- read repository continuity manifests;
- evaluate them with the existing deterministic audit engine;
- publish GitHub Check Run evidence;
- report exact-head findings and proof cookies.

It is not allowed to:

- modify repository contents;
- open or merge pull requests;
- change branch protections or repository administration settings;
- read or rotate repository secrets;
- obtain or use wallet/private keys;
- broadcast mainnet transactions or transfer value.

Any future auto-repair mode must be a separate, explicit authority expansion with its own permissions, rollback contract, and verification evidence. Do not silently widen this App installation from read/audit authority into write/merge authority.
