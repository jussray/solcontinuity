import assert from "node:assert/strict";
import test from "node:test";
import {
  FCR_PROVIDER_CHANGE_EVENT_KIND,
  assessProviderChangeContinuity,
  fingerprintProviderChangeEvent,
  type ProviderChangeEvent,
} from "../src/core/provider-change-continuity.js";

function event(overrides: Partial<ProviderChangeEvent> = {}): ProviderChangeEvent {
  const base = {
    version: 1 as const,
    kind: FCR_PROVIDER_CHANGE_EVENT_KIND,
    provider: "openai" as const,
    category: "computer_use" as const,
    headline: "Computer use expanded to paid plans",
    change_summary: "Cloud browser capability is now available on paid plans.",
    availability: "PLAN_GATED" as const,
    source_url: "https://openai.com/news/product-releases/example",
    evidence_urls: ["https://openai.com/news/product-releases/example"],
    published_at: "2026-10-28T10:00:00Z",
    observed_at: "2026-10-28T10:10:00Z",
    effective_at: "2026-10-29T00:00:00Z",
    previous_state: "Computer use unavailable on Free plan.",
    new_state: "Computer use available on paid plans.",
    source_coverage: "COMPLETE" as const,
    project_impacts: { fcr: "Compare paid-plan capability.", chief: "Assess bounded coding use.", solcontinuity: "Validate event freshness.", promptos: "Run provider comparison prompt." },
    safe_test: "Read the public plan page and compare its stated availability.",
  };
  const composed = { ...base, ...overrides };
  const eventFingerprint = fingerprintProviderChangeEvent(composed);
  return { ...composed, event_fingerprint: eventFingerprint };
}

test("accepts a fresh, official, correctly fingerprinted event as new evidence", () => {
  const receipt = event();
  assert.equal(assessProviderChangeContinuity(receipt, [], "2026-10-28T10:20:00Z").status, "NEW");
});

test("recognizes the same event fingerprint as a duplicate", () => {
  const receipt = event();
  const result = assessProviderChangeContinuity(receipt, [receipt.event_fingerprint], "2026-10-28T10:20:00Z");
  assert.equal(result.status, "DUPLICATE");
  assert.equal(result.execution_authorized, false);
});

test("marks an event stale after two hours without calling it current", () => {
  const receipt = event();
  const result = assessProviderChangeContinuity(receipt, [], "2026-10-28T12:11:00Z");
  assert.equal(result.status, "STALE");
  assert.deepEqual(result.reasons, ["OBSERVATION_OLDER_THAN_TWO_HOURS"]);
});

test("rejects non-official sources and altered fingerprints", () => {
  const receipt = event({ source_url: "https://example.com/fake" });
  assert.equal(assessProviderChangeContinuity(receipt, [], "2026-10-28T10:20:00Z").status, "INVALID");
  const official = event();
  assert.equal(assessProviderChangeContinuity({ ...official, event_fingerprint: "0".repeat(64) }, [], "2026-10-28T10:20:00Z").status, "INVALID");
});

test("does not promote incomplete source coverage to a new verified event", () => {
  const receipt = event({ source_coverage: "PARTIAL" });
  const result = assessProviderChangeContinuity(receipt, [], "2026-10-28T10:20:00Z");
  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(result.reasons, ["SOURCE_COVERAGE_PARTIAL"]);
});
