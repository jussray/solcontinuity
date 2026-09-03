import { createHash } from 'node:crypto';

export const PORTABLE_CAPABILITY_ROUTING_CONTRACT = 'juss/portable-capability-routing@v1';
export const PORTABLE_CAPABILITY_CONTINUITY_CONTRACT = 'juss/portable-capability-continuity@v1';

const SHA256 = /^[0-9a-f]{64}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).map(text).filter(Boolean))].sort();
}

function optionalFingerprint(value) {
  const normalized = text(value).toLowerCase();
  return normalized || null;
}

function normalizeRouteState(input) {
  return {
    projectSlug: text(input.projectSlug),
    repositoryFullName: text(input.repositoryFullName).toLowerCase(),
    targetRef: text(input.targetRef),
    targetSha: text(input.targetSha).toLowerCase() || null,
    taskClass: text(input.taskClass),
    requiredCapabilityClasses: uniqueSorted(input.requiredCapabilityClasses),
    selectedCapabilityClasses: uniqueSorted(input.selectedCapabilityClasses),
    implementationId: text(input.implementationId).toLowerCase(),
    providerId: text(input.providerId).toLowerCase(),
    runtimeId: text(input.runtimeId).toLowerCase(),
    runtimeVersion: text(input.runtimeVersion),
    availabilityFingerprint: optionalFingerprint(input.availabilityFingerprint),
    permissionFingerprint: optionalFingerprint(input.permissionFingerprint),
    evidenceFingerprint: optionalFingerprint(input.evidenceFingerprint),
    authorityFingerprint: optionalFingerprint(input.authorityFingerprint),
    verificationFingerprint: optionalFingerprint(input.verificationFingerprint),
  };
}

export function capabilityDimensionFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function capabilityRouteInputErrors(input) {
  const value = normalizeRouteState(input);
  const errors = [];

  if (!value.projectSlug) errors.push('projectSlug is required');
  if (!value.taskClass) errors.push('taskClass is required');
  if (value.requiredCapabilityClasses.length === 0) errors.push('at least one requiredCapabilityClass is required');
  if (value.selectedCapabilityClasses.length === 0) errors.push('at least one selectedCapabilityClass is required');
  if (!value.implementationId) errors.push('implementationId is required');
  if (!value.providerId) errors.push('providerId is required');
  if (!value.runtimeId) errors.push('runtimeId is required');
  if (!value.runtimeVersion) errors.push('runtimeVersion is required');
  if (value.targetSha !== null && !FULL_SHA.test(value.targetSha)) {
    errors.push('targetSha must be a full 40-character Git SHA or null');
  }

  const selected = new Set(value.selectedCapabilityClasses);
  for (const required of value.requiredCapabilityClasses) {
    if (!selected.has(required)) errors.push(`selected capability route is missing required class: ${required}`);
  }

  for (const [field, fingerprint] of [
    ['availabilityFingerprint', value.availabilityFingerprint],
    ['permissionFingerprint', value.permissionFingerprint],
    ['evidenceFingerprint', value.evidenceFingerprint],
    ['authorityFingerprint', value.authorityFingerprint],
    ['verificationFingerprint', value.verificationFingerprint],
  ]) {
    if (fingerprint !== null && !SHA256.test(fingerprint)) {
      errors.push(`${field} must be a 64-character SHA-256 hash or null`);
    }
  }

  return [...new Set(errors)];
}

export function capabilityRouteFingerprint(input) {
  const value = normalizeRouteState(input);
  const errors = capabilityRouteInputErrors(value);
  if (errors.length > 0) throw new Error(errors.join('; '));

  return createHash('sha256').update(JSON.stringify([
    PORTABLE_CAPABILITY_ROUTING_CONTRACT,
    value.projectSlug,
    value.repositoryFullName,
    value.targetRef,
    value.targetSha,
    value.taskClass,
    value.requiredCapabilityClasses,
    value.selectedCapabilityClasses,
    value.implementationId,
    value.providerId,
    value.runtimeId,
    value.runtimeVersion,
    value.availabilityFingerprint,
    value.permissionFingerprint,
    value.evidenceFingerprint,
    value.authorityFingerprint,
    value.verificationFingerprint,
  ])).digest('hex');
}

function authorityRank(value) {
  switch (text(value).toLowerCase()) {
    case 'observe': return 0;
    case 'draft': return 1;
    case 'write': return 2;
    case 'privileged': return 3;
    default: return Number.POSITIVE_INFINITY;
  }
}

export function selectStrongestEligibleCapability({
  requiredCapabilityClasses,
  candidates,
  maxAuthority = 'privileged',
}) {
  const required = uniqueSorted(requiredCapabilityClasses);
  const ceiling = authorityRank(maxAuthority);
  if (required.length === 0) {
    return { status: 'blocked', selected: null, reason: 'required capability classes are empty' };
  }
  if (!Number.isFinite(ceiling)) {
    return { status: 'blocked', selected: null, reason: 'maxAuthority is unsupported' };
  }

  const eligible = (candidates ?? []).filter((candidate) => {
    if (candidate?.available !== true || candidate?.permitted !== true) return false;
    if (!text(candidate.id) || !text(candidate.providerId) || !Number.isFinite(candidate.priority)) return false;
    if (authorityRank(candidate.authorityCeiling) > ceiling) return false;
    const classes = new Set(uniqueSorted(candidate.capabilityClasses));
    return required.every((capabilityClass) => classes.has(capabilityClass));
  });

  eligible.sort((a, b) => (
    Number(b.priority) - Number(a.priority)
    || text(a.providerId).localeCompare(text(b.providerId))
    || text(a.id).localeCompare(text(b.id))
  ));

  if (eligible.length === 0) {
    return {
      status: 'blocked',
      selected: null,
      reason: 'no available permitted capability satisfies the required classes within the authority ceiling',
    };
  }

  return {
    status: 'selected',
    selected: eligible[0],
    reason: 'selected the highest-priority eligible available capability declared by policy',
  };
}

export function createCapabilityContinuityCookie(routeState, {
  observedAt,
  expiresAt,
  predecessorFingerprint = null,
  evidenceRefs = [],
} = {}) {
  const state = normalizeRouteState(routeState);
  const errors = capabilityRouteInputErrors(state);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const observed = text(observedAt);
  const expires = text(expiresAt);
  const observedMs = Date.parse(observed);
  const expiresMs = Date.parse(expires);
  if (!Number.isFinite(observedMs)) throw new Error('observedAt must be an ISO-compatible timestamp');
  if (!Number.isFinite(expiresMs)) throw new Error('expiresAt must be an ISO-compatible timestamp');
  if (expiresMs <= observedMs) throw new Error('expiresAt must be later than observedAt');

  const predecessor = optionalFingerprint(predecessorFingerprint);
  if (predecessor !== null && !SHA256.test(predecessor)) {
    throw new Error('predecessorFingerprint must be a 64-character SHA-256 hash or null');
  }

  return {
    contract: PORTABLE_CAPABILITY_CONTINUITY_CONTRACT,
    ...state,
    evidenceRefs: uniqueSorted(evidenceRefs),
    observedAt: observed,
    expiresAt: expires,
    predecessorFingerprint: predecessor,
    fingerprint: capabilityRouteFingerprint(state),
    browserCookie: false,
    authorizing: false,
    approvalCarryForward: false,
    standingMutationAuthority: false,
    founderDecisionRequiredForPrivilegedMutation: true,
  };
}

export function evaluateCapabilityContinuityCookie(cookie, currentRouteState, now) {
  const reasons = [];
  const add = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  if (cookie?.contract !== PORTABLE_CAPABILITY_CONTINUITY_CONTRACT) add('cookie_invalid');
  if (cookie?.browserCookie !== false) add('cookie_invalid');
  if (cookie?.authorizing !== false) add('cookie_invalid');
  if (cookie?.approvalCarryForward !== false) add('cookie_invalid');
  if (cookie?.standingMutationAuthority !== false) add('cookie_invalid');
  if (cookie?.founderDecisionRequiredForPrivilegedMutation !== true) add('cookie_invalid');

  let current;
  try {
    current = normalizeRouteState(currentRouteState);
    const currentErrors = capabilityRouteInputErrors(current);
    if (currentErrors.length > 0) add('current_route_invalid');
  } catch {
    add('current_route_invalid');
  }

  const nowMs = Date.parse(text(now));
  const expiresMs = Date.parse(text(cookie?.expiresAt));
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) {
    add('observation_time_invalid');
  } else if (nowMs > expiresMs) {
    add('cookie_expired');
  }

  if (!reasons.includes('cookie_invalid') && !reasons.includes('current_route_invalid')) {
    const prior = normalizeRouteState(cookie);
    if (cookie.fingerprint !== capabilityRouteFingerprint(prior)) add('cookie_invalid');
    if (prior.projectSlug !== current.projectSlug) add('project_moved');
    if (prior.repositoryFullName !== current.repositoryFullName) add('repository_moved');
    if (prior.targetRef !== current.targetRef) add('target_ref_moved');
    if (prior.targetSha !== current.targetSha) add('target_sha_moved');
    if (prior.taskClass !== current.taskClass) add('task_class_moved');
    if (JSON.stringify(prior.requiredCapabilityClasses) !== JSON.stringify(current.requiredCapabilityClasses)) add('required_capability_moved');
    if (JSON.stringify(prior.selectedCapabilityClasses) !== JSON.stringify(current.selectedCapabilityClasses)) add('selected_capability_moved');
    if (prior.implementationId !== current.implementationId) add('implementation_moved');
    if (prior.providerId !== current.providerId) add('provider_moved');
    if (prior.runtimeId !== current.runtimeId || prior.runtimeVersion !== current.runtimeVersion) add('runtime_moved');
    if (prior.availabilityFingerprint !== current.availabilityFingerprint) add('availability_moved');
    if (prior.permissionFingerprint !== current.permissionFingerprint) add('permission_moved');
    if (prior.evidenceFingerprint !== current.evidenceFingerprint) add('evidence_moved');
    if (prior.authorityFingerprint !== current.authorityFingerprint) add('authority_moved');
    if (prior.verificationFingerprint !== current.verificationFingerprint) add('verification_moved');
  }

  const invalid = reasons.includes('cookie_invalid')
    || reasons.includes('current_route_invalid')
    || reasons.includes('observation_time_invalid');

  return {
    state: invalid ? 'invalid' : reasons.length > 0 ? 'stale' : 'current',
    reasons: [...reasons].sort((a, b) => a.localeCompare(b)),
    reacquireRequired: invalid || reasons.length > 0,
    continuityMayAuthorizeAction: false,
  };
}
