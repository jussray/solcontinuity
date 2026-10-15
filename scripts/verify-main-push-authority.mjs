#!/usr/bin/env node

const EXPECTED_REPOSITORY = 'jussray/solcontinuity';
const EXPECTED_REF = 'refs/heads/main';
const EXPECTED_FOUNDER = 'jussray';
const SHA = /^[0-9a-f]{40}$/;

const repository = process.env.SOLCONTINUITY_REPOSITORY || '';
const ref = process.env.SOLCONTINUITY_REF || '';
const actor = process.env.SOLCONTINUITY_ACTOR || '';
const triggeringActor = process.env.SOLCONTINUITY_TRIGGERING_ACTOR || '';
const forced = process.env.SOLCONTINUITY_FORCED || '';
const before = process.env.SOLCONTINUITY_BEFORE_SHA || '';
const after = process.env.SOLCONTINUITY_AFTER_SHA || '';

const errors = [];
if (repository !== EXPECTED_REPOSITORY) errors.push(`repository must be ${EXPECTED_REPOSITORY}`);
if (ref !== EXPECTED_REF) errors.push(`ref must be ${EXPECTED_REF}`);
if (actor !== EXPECTED_FOUNDER) errors.push(`actor must be ${EXPECTED_FOUNDER}`);
if (triggeringActor !== EXPECTED_FOUNDER) errors.push(`triggering actor must be ${EXPECTED_FOUNDER}`);
if (forced !== 'false') errors.push('main push must not be forced');
if (!SHA.test(before) || /^0{40}$/.test(before)) errors.push('before SHA must be a real 40-character commit SHA');
if (!SHA.test(after) || /^0{40}$/.test(after)) errors.push('after SHA must be a real 40-character commit SHA');
if (before === after) errors.push('before and after SHA must differ');

const receipt = {
  repository,
  ref,
  actor,
  triggeringActor,
  forced,
  before,
  after,
  founderAuthorized: errors.length === 0,
};

console.log(JSON.stringify(receipt));

if (errors.length) {
  console.error('SolContinuity main push authority verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
