import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  buildSocialAnalyticsContinuityMarker,
  compareSocialAnalyticsContinuity,
  validateChiefSocialAnalyticsDecision,
} from "../src/core/social-analytics-continuity.js";

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function decision(overrides: Partial<Record<string, unknown>> = {}) {
  const identity = {
    version: 1,
    kind: "chief-ai/social-analytics-decision-input@v1",
    source_system: "founder-control-room",
    control_receipt_hash: "a".repeat(64),
    challenger_receipt_hash: "b".repeat(64),
    account_id: "@juss_fn_ray",
    platform: "instagram",
    primary_metric: "views",
    comparison_state: "COMPATIBLE",
    incompatibility_reasons: [] as string[],
    control_value: 100,
    challenger_value: 140,
    recommendation: "MEASURE",
    ...overrides,
  };
  return {
    ...identity,
    decision_hash: sha(identity),
    authority: {
      evidence_only: true,
      learning_authority: "advisory_only",
      execution_authorized: false,
      publish_authorized: false,
      content_mutation_authorized: false,
      may_increase_authority: false,
    },
  };
}

test("builds a non-authorizing continuity marker from the exact Chief decision hash", () => {
  const source = decision();
  const marker = buildSocialAnalyticsContinuityMarker(source, { current_gate: "MEASURE" });
  assert.equal(marker.source_decision_hash, source.decision_hash);
  assert.equal(marker.control_receipt_hash, source.control_receipt_hash);
  assert.equal(marker.challenger_receipt_hash, source.challenger_receipt_hash);
  assert.match(marker.continuity_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(marker.cookie_id, /^social:[0-9a-f]{24}$/);
  assert.equal(marker.authority.creates_truth, false);
  assert.equal(marker.authority.creates_authority, false);
  assert.equal(marker.authority.publish_authorized, false);
});

test("same exact decision keeps continuity fresh", () => {
  const source = decision();
  const marker = buildSocialAnalyticsContinuityMarker(source);
  assert.deepEqual(compareSocialAnalyticsContinuity(marker, source), { stale: false, reasons: [] });
});

test("changed FCR receipt lineage invalidates the previous marker", () => {
  const source = decision();
  const marker = buildSocialAnalyticsContinuityMarker(source);
  const changed = decision({ challenger_receipt_hash: "c".repeat(64), challenger_value: 160 });
  const result = compareSocialAnalyticsContinuity(marker, changed);
  assert.equal(result.stale, true);
  assert.ok(result.reasons.includes("decision-hash-changed"));
  assert.ok(result.reasons.includes("challenger-receipt-changed"));
});

test("changed account invalidates continuity instead of carrying evidence across accounts", () => {
  const source = decision();
  const marker = buildSocialAnalyticsContinuityMarker(source);
  const changed = decision({ account_id: "@jussnco" });
  const result = compareSocialAnalyticsContinuity(marker, changed);
  assert.equal(result.stale, true);
  assert.ok(result.reasons.includes("account-changed"));
});

test("tampered Chief decision hash is rejected", () => {
  const source = decision();
  assert.throws(
    () => validateChiefSocialAnalyticsDecision({ ...source, primary_metric: "shares" }),
    /decision_hash does not match exact Chief decision identity/,
  );
});

test("continuity cannot accept widened Chief authority", () => {
  const source = decision();
  assert.throws(
    () => validateChiefSocialAnalyticsDecision({
      ...source,
      authority: { ...source.authority, publish_authorized: true },
    }),
    /authority must remain advisory-only/,
  );
});
