import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorldLearningContinuityCookie,
  evaluateWorldLearningContinuityCookie,
} from './world-learning-continuity.mjs';

const NOW = new Date('2026-09-23T02:40:00.000Z');

function cookie() {
  return createWorldLearningContinuityCookie({
    experimentId: 'fb-0042',
    predictionReceiptId: 'prediction-42',
    observationReceiptId: 'observation-42',
    learningDeltaId: 'learning-42',
    evidenceRefs: ['fcr://world-observation/fb-0042'],
    observedAt: '2026-09-23T02:30:00.000Z',
    expiresAt: '2026-09-30T02:30:00.000Z',
  }, NOW);
}

test('world learning continuity is current only while its evidence identity stays fixed', () => {
  const value = cookie();
  assert.match(value.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(evaluateWorldLearningContinuityCookie(value, { evidenceVerified: true }, NOW), { state: 'current', reasons: [] });
  assert.equal(value.authority.authorizesExecution, false);
});

test('world learning continuity goes stale when an observation moves', () => {
  const result = evaluateWorldLearningContinuityCookie(cookie(), {
    evidenceVerified: true,
    observationReceiptId: 'observation-43',
  }, NOW);
  assert.equal(result.state, 'stale');
  assert.deepEqual(result.reasons, ['observation_moved']);
});

test('contradictory evidence outranks a previously current learning', () => {
  const result = evaluateWorldLearningContinuityCookie(cookie(), {
    evidenceVerified: true,
    contradicted: true,
  }, NOW);
  assert.equal(result.state, 'contradicted');
});

test('unverified evidence cannot keep a learning current', () => {
  const result = evaluateWorldLearningContinuityCookie(cookie(), { evidenceVerified: false }, NOW);
  assert.deepEqual(result, { state: 'unverified', reasons: ['evidence_unverified'] });
});

test('expired learning becomes stale', () => {
  const result = evaluateWorldLearningContinuityCookie(cookie(), { evidenceVerified: true }, new Date('2026-10-01T00:00:00.000Z'));
  assert.equal(result.state, 'stale');
  assert.deepEqual(result.reasons, ['expired']);
});
