import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capabilityDimensionFingerprint,
  capabilityRouteFingerprint,
  createCapabilityContinuityCookie,
  evaluateCapabilityContinuityCookie,
  selectStrongestEligibleCapability,
} from './capability-routing.mjs';

const fp = (value) => capabilityDimensionFingerprint(value);

const base = {
  projectSlug: 'founder-control-room',
  repositoryFullName: 'jussray/founder-control-room',
  targetRef: 'main',
  targetSha: 'a'.repeat(40),
  taskClass: 'repository-change',
  requiredCapabilityClasses: ['repository.read', 'repository.write'],
  selectedCapabilityClasses: ['repository.write', 'repository.read'],
  implementationId: 'github-connector',
  providerId: 'github',
  runtimeId: 'chatgpt',
  runtimeVersion: '2026-09-03',
  availabilityFingerprint: fp({ installed: true, connected: true }),
  permissionFingerprint: fp({ read: true, write: true }),
  evidenceFingerprint: fp({ head: 'a'.repeat(40), checks: 'pending' }),
  authorityFingerprint: fp({ ceiling: 'write', founderApproved: true }),
  verificationFingerprint: fp({ source: true, runtime: false }),
};

test('selects the strongest eligible available capability declared by policy', () => {
  const result = selectStrongestEligibleCapability({
    requiredCapabilityClasses: ['repository.read', 'repository.write'],
    maxAuthority: 'write',
    candidates: [
      {
        id: 'manual-copy-paste',
        providerId: 'manual',
        capabilityClasses: ['repository.read', 'repository.write'],
        available: true,
        permitted: true,
        authorityCeiling: 'write',
        priority: 10,
      },
      {
        id: 'github-connector',
        providerId: 'github',
        capabilityClasses: ['repository.read', 'repository.write'],
        available: true,
        permitted: true,
        authorityCeiling: 'write',
        priority: 100,
      },
      {
        id: 'unavailable-super-tool',
        providerId: 'other',
        capabilityClasses: ['repository.read', 'repository.write'],
        available: false,
        permitted: true,
        authorityCeiling: 'write',
        priority: 999,
      },
    ],
  });

  assert.equal(result.status, 'selected');
  assert.equal(result.selected.id, 'github-connector');
});

test('does not route around permission or authority ceilings', () => {
  const result = selectStrongestEligibleCapability({
    requiredCapabilityClasses: ['provider.write'],
    maxAuthority: 'draft',
    candidates: [
      {
        id: 'provider-admin',
        providerId: 'provider',
        capabilityClasses: ['provider.write'],
        available: true,
        permitted: true,
        authorityCeiling: 'privileged',
        priority: 100,
      },
      {
        id: 'denied-writer',
        providerId: 'provider',
        capabilityClasses: ['provider.write'],
        available: true,
        permitted: false,
        authorityCeiling: 'draft',
        priority: 50,
      },
    ],
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.selected, null);
});

test('route fingerprint binds implementation, runtime, authority, evidence, and verification state', () => {
  const original = capabilityRouteFingerprint(base);
  for (const change of [
    { implementationId: 'codex' },
    { providerId: 'openai' },
    { runtimeVersion: '2026-09-04' },
    { authorityFingerprint: fp({ ceiling: 'draft', founderApproved: false }) },
    { evidenceFingerprint: fp({ head: 'a'.repeat(40), checks: 'green' }) },
    { verificationFingerprint: fp({ source: true, runtime: true }) },
  ]) {
    assert.notEqual(capabilityRouteFingerprint({ ...base, ...change }), original);
  }
});

test('continuity cookie is non-browser, non-authorizing audit state', () => {
  const cookie = createCapabilityContinuityCookie(base, {
    observedAt: '2026-09-03T20:00:00.000Z',
    expiresAt: '2026-09-03T20:30:00.000Z',
    evidenceRefs: ['github:main', 'github:permissions'],
  });

  assert.equal(cookie.browserCookie, false);
  assert.equal(cookie.authorizing, false);
  assert.equal(cookie.approvalCarryForward, false);
  assert.equal(cookie.standingMutationAuthority, false);
  assert.equal(cookie.founderDecisionRequiredForPrivilegedMutation, true);
  assert.match(cookie.fingerprint, /^[0-9a-f]{64}$/);
});

test('continuity is stale when the capability route or evidence moves', () => {
  const cookie = createCapabilityContinuityCookie(base, {
    observedAt: '2026-09-03T20:00:00.000Z',
    expiresAt: '2026-09-03T20:30:00.000Z',
  });

  const result = evaluateCapabilityContinuityCookie(cookie, {
    ...base,
    runtimeId: 'codex',
    evidenceFingerprint: fp({ head: 'a'.repeat(40), checks: 'green' }),
  }, '2026-09-03T20:10:00.000Z');

  assert.equal(result.state, 'stale');
  assert.equal(result.reacquireRequired, true);
  assert.equal(result.continuityMayAuthorizeAction, false);
  assert.ok(result.reasons.includes('runtime_moved'));
  assert.ok(result.reasons.includes('evidence_moved'));
});

test('expired continuity never carries authority forward', () => {
  const cookie = createCapabilityContinuityCookie(base, {
    observedAt: '2026-09-03T20:00:00.000Z',
    expiresAt: '2026-09-03T20:30:00.000Z',
  });

  const result = evaluateCapabilityContinuityCookie(
    cookie,
    base,
    '2026-09-03T20:30:00.001Z',
  );

  assert.equal(result.state, 'stale');
  assert.ok(result.reasons.includes('cookie_expired'));
  assert.equal(result.continuityMayAuthorizeAction, false);
});
