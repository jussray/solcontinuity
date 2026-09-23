import { createHash } from 'node:crypto';

export const WORLD_LEARNING_CONTINUITY_CONTRACT = 'juss/world-learning-continuity@v1';
export const WORLD_LEARNING_STATES = Object.freeze(['current', 'stale', 'contradicted', 'unverified', 'superseded']);

function text(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function refs(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => text(value, 500)).filter(Boolean))].slice(0, 30);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function iso(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
}

export function createWorldLearningContinuityCookie(input = {}, now = new Date()) {
  const experimentId = text(input.experimentId, 180);
  const predictionReceiptId = text(input.predictionReceiptId, 180);
  const observationReceiptId = text(input.observationReceiptId, 180);
  const learningDeltaId = text(input.learningDeltaId, 180);
  const evidenceRefs = refs(input.evidenceRefs);
  const observedAt = iso(input.observedAt || now);
  const expiresAt = iso(input.expiresAt);

  if (!experimentId || !predictionReceiptId || !observationReceiptId || !learningDeltaId) {
    throw new Error('World learning continuity requires bound experiment, prediction, observation, and learning ids');
  }
  if (evidenceRefs.length === 0) throw new Error('World learning continuity requires bounded evidence references');
  if (!observedAt || !expiresAt) throw new Error('World learning continuity requires valid observedAt and expiresAt timestamps');
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) throw new Error('World learning continuity expiry must follow observation time');

  const subject = {
    schema: WORLD_LEARNING_CONTINUITY_CONTRACT,
    experimentId,
    predictionReceiptId,
    observationReceiptId,
    learningDeltaId,
    predecessorFingerprint: text(input.predecessorFingerprint, 64) || null,
    evidenceRefs,
    observedAt,
    expiresAt,
  };

  return Object.freeze({
    ...subject,
    fingerprint: hash(subject),
    state: 'current',
    createdAt: now.toISOString(),
    authority: Object.freeze({
      scope: 'continuity-only',
      authorizesExecution: false,
      authorizesPublishing: false,
      authorizesMerge: false,
      authorizesDeployment: false,
      authorizesAuthorityTransfer: false,
    }),
  });
}

export function evaluateWorldLearningContinuityCookie(cookie, current = {}, now = new Date()) {
  const reasons = [];
  if (!cookie || typeof cookie !== 'object' || cookie.schema !== WORLD_LEARNING_CONTINUITY_CONTRACT) {
    return { state: 'unverified', reasons: ['invalid_cookie'] };
  }

  const subject = {
    schema: cookie.schema,
    experimentId: cookie.experimentId,
    predictionReceiptId: cookie.predictionReceiptId,
    observationReceiptId: cookie.observationReceiptId,
    learningDeltaId: cookie.learningDeltaId,
    predecessorFingerprint: cookie.predecessorFingerprint ?? null,
    evidenceRefs: cookie.evidenceRefs,
    observedAt: cookie.observedAt,
    expiresAt: cookie.expiresAt,
  };
  if (hash(subject) !== cookie.fingerprint) return { state: 'unverified', reasons: ['fingerprint_mismatch'] };
  if (current.evidenceVerified === false) return { state: 'unverified', reasons: ['evidence_unverified'] };
  if (current.supersededByFingerprint) return { state: 'superseded', reasons: ['successor_present'] };
  if (current.contradicted === true) return { state: 'contradicted', reasons: ['new_evidence_contradicts_learning'] };

  if (current.experimentId && current.experimentId !== cookie.experimentId) reasons.push('experiment_moved');
  if (current.predictionReceiptId && current.predictionReceiptId !== cookie.predictionReceiptId) reasons.push('prediction_moved');
  if (current.observationReceiptId && current.observationReceiptId !== cookie.observationReceiptId) reasons.push('observation_moved');
  if (current.learningDeltaId && current.learningDeltaId !== cookie.learningDeltaId) reasons.push('learning_delta_moved');
  if (Date.parse(now.toISOString()) > Date.parse(cookie.expiresAt)) reasons.push('expired');

  return { state: reasons.length > 0 ? 'stale' : 'current', reasons: reasons.sort() };
}
