const FULL_SHA = /^[0-9a-f]{40}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const AUTHORITY = Object.freeze({
  evidenceOnly: true,
  createsTruth: false,
  createsAuthority: false,
  executionAuthorized: false,
  mergeAuthorized: false,
  deployAuthorized: false,
  publishAuthorized: false,
  credentialMutationAuthorized: false,
  providerMutationAuthorized: false,
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim().slice(0, max);
}

function fullSha(value, label) {
  const out = text(value, label, 40).toLowerCase();
  if (!FULL_SHA.test(out)) throw new Error(`${label} must be a full git SHA`);
  return out;
}

function hash(value, label) {
  const out = text(value, label, 64).toLowerCase();
  if (!HASH.test(out)) throw new Error(`${label} must be SHA-256`);
  return out;
}

function instant(value, label) {
  const raw = text(value, label, 80);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be an ISO timestamp`);
  return { raw, ms };
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(stable(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function exactAuthority(value, label = 'authority') {
  const input = record(value, label);
  for (const [key, expected] of Object.entries(AUTHORITY)) {
    if (input[key] !== expected) throw new Error(`${label}.${key} widened or missing`);
  }
  return AUTHORITY;
}

function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function buildMarker(input, checkedAt = new Date().toISOString()) {
  const source = record(input, 'handoff');
  if (source.schema !== 'juss/sol-court-continuity-handoff@v1') throw new Error('unsupported handoff schema');

  const repository = text(source.repository, 'repository', 300);
  const branch = text(source.branch, 'branch', 200);
  const headSha = fullSha(source.headSha, 'headSha');
  const witnessReceiptFingerprint = hash(source.witnessReceiptFingerprint, 'witnessReceiptFingerprint');
  const sourceHandoffFingerprint = hash(source.handoffFingerprint, 'handoffFingerprint');
  const observedAt = instant(source.observedAt, 'observedAt');
  const expiresAt = instant(source.expiresAt, 'expiresAt');
  if (expiresAt.ms <= observedAt.ms) throw new Error('expiresAt must be after observedAt');
  exactAuthority(source.authority);

  const core = { ...source };
  delete core.handoffFingerprint;
  if (await sha256(core) !== sourceHandoffFingerprint) throw new Error('handoff fingerprint mismatch');

  const summary = record(source.evidenceSummary, 'evidenceSummary');
  const witnesses = Array.isArray(source.witnesses) ? source.witnesses : (() => { throw new Error('witnesses must be an array'); })();
  const staleWitnessIds = [];
  const allChains = [];
  const freshChains = [];
  for (const raw of witnesses) {
    const witness = record(raw, 'witness');
    const id = text(witness.id, 'witness.id', 160);
    const witnessHead = fullSha(witness.headSha, 'witness.headSha');
    const chain = text(witness.sourceFingerprint, 'witness.sourceFingerprint', 240);
    allChains.push(chain);
    const stale = witness.stale === true || witnessHead !== headSha;
    if (stale) staleWitnessIds.push(id);
    else freshChains.push(chain);
  }
  const duplicateChainCount = allChains.length - new Set(allChains).size;
  const uniqueEvidenceChainCount = new Set(freshChains).size;
  if (summary.duplicateChains !== duplicateChainCount) throw new Error('duplicate-chain summary disagrees with witnesses');
  if (summary.uniqueChains !== uniqueEvidenceChainCount) throw new Error('unique-chain summary disagrees with witnesses');

  const checked = instant(checkedAt, 'checkedAt');
  const leaseState = checked.ms > expiresAt.ms ? 'EXPIRED' : 'FRESH';
  const driftReasons = [];
  if (leaseState === 'EXPIRED') driftReasons.push('handoff-lease-expired');
  if (staleWitnessIds.length) driftReasons.push('stale-or-mismatched-witness-present');

  const identity = {
    version: 1,
    kind: 'sol/court-continuity@v1',
    source_handoff_fingerprint: sourceHandoffFingerprint,
    witness_receipt_fingerprint: witnessReceiptFingerprint,
    repository,
    branch,
    head_sha: headSha,
    observed_at: observedAt.raw,
    expires_at: expiresAt.raw,
    lease_state: leaseState,
    continuity_state: driftReasons.length ? 'CHALLENGE' : 'FRESH',
    stale_witness_ids: [...new Set(staleWitnessIds)],
    duplicate_chain_count: duplicateChainCount,
    unique_evidence_chain_count: uniqueEvidenceChainCount,
    drift_reasons: driftReasons,
  };

  return {
    ...identity,
    continuity_fingerprint: await sha256(identity),
    authority: AUTHORITY,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        service: 'solcontinuity-court',
        release_sha: FULL_SHA.test(String(env.SOL_COURT_RELEASE_SHA || '')) ? String(env.SOL_COURT_RELEASE_SHA).toLowerCase() : 'unknown',
        authority: 'none',
      });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/court/continuity') return json({ error: 'not found' }, 404);
    if (!env.SOLCONTINUITY_COURT_BRIDGE_TOKEN) return json({ error: 'court bridge not configured' }, 503);
    const bearer = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (!timingSafeEqual(bearer, env.SOLCONTINUITY_COURT_BRIDGE_TOKEN)) return json({ error: 'unauthorized' }, 401);
    try {
      const marker = await buildMarker(await request.json());
      return json({ service: 'solcontinuity-api', marker, authority: 'none' });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'invalid Court handoff' }, 400);
    }
  },
};
