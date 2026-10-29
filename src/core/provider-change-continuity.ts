import { createHash } from "node:crypto";

export const FCR_PROVIDER_CHANGE_EVENT_KIND = "juss.ai-provider-change@v1";

export type ProviderChangeProvider = "openai" | "anthropic" | "perplexity";
export type ProviderChangeCategory =
  | "coding"
  | "computer_use"
  | "integrations"
  | "authorized_actions"
  | "pricing"
  | "plans"
  | "limits";
export type ProviderChangeAvailability =
  | "GA"
  | "PREVIEW"
  | "BETA"
  | "PLAN_GATED"
  | "REGION_GATED"
  | "DEVICE_GATED"
  | "API_BILLED"
  | "UNKNOWN";

export interface ProviderChangeEvent {
  version: 1;
  kind: typeof FCR_PROVIDER_CHANGE_EVENT_KIND;
  provider: ProviderChangeProvider;
  category: ProviderChangeCategory;
  headline: string;
  change_summary: string;
  availability: ProviderChangeAvailability;
  source_url: string;
  evidence_urls: string[];
  published_at: string | null;
  effective_at: string | null;
  observed_at: string;
  previous_state: string | null;
  new_state: string;
  source_coverage: "COMPLETE" | "PARTIAL" | "FAILED";
  project_impacts: { fcr: string; chief: string; solcontinuity: string; promptos: string };
  safe_test: string;
  event_fingerprint: string;
}

export type ProviderChangeContinuityStatus = "NEW" | "DUPLICATE" | "STALE" | "INVALID";

export interface ProviderChangeContinuityAssessment {
  status: ProviderChangeContinuityStatus;
  fingerprint: string | null;
  reasons: string[];
  evidence_only: true;
  execution_authorized: false;
}

const HASH = /^[0-9a-f]{64}$/;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const OFFICIAL_HOSTS: Record<ProviderChangeProvider, string[]> = {
  openai: ["openai.com"],
  anthropic: ["anthropic.com", "claude.com"],
  perplexity: ["perplexity.ai"],
};
const CATEGORIES = new Set<ProviderChangeCategory>([
  "coding", "computer_use", "integrations", "authorized_actions", "pricing", "plans", "limits",
]);
const AVAILABILITY = new Set<ProviderChangeAvailability>([
  "GA", "PREVIEW", "BETA", "PLAN_GATED", "REGION_GATED", "DEVICE_GATED", "API_BILLED", "UNKNOWN",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isOfficialUrl(provider: ProviderChangeProvider, value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OFFICIAL_HOSTS[provider].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function normalized(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export function fingerprintProviderChangeEvent(
  event: Omit<ProviderChangeEvent, "event_fingerprint" | "version" | "kind" | "evidence_urls">,
): string {
  const canonical = {
    provider: event.provider,
    category: event.category,
    source_url: event.source_url.trim().replace(/\/$/, ""),
    published_at: event.published_at,
    headline: normalized(event.headline),
    availability: event.availability,
    change_summary: normalized(event.change_summary),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validateProviderChangeEvent(input: unknown): string[] {
  if (!isRecord(input)) return ["EVENT_NOT_OBJECT"];
  const provider = input.provider;
  if (provider !== "openai" && provider !== "anthropic" && provider !== "perplexity") {
    return ["PROVIDER_INVALID"];
  }
  const issues: string[] = [];
  if (input.version !== 1 || input.kind !== FCR_PROVIDER_CHANGE_EVENT_KIND) issues.push("SCHEMA_INVALID");
  if (!CATEGORIES.has(input.category as ProviderChangeCategory)) issues.push("CATEGORY_INVALID");
  if (!AVAILABILITY.has(input.availability as ProviderChangeAvailability)) issues.push("AVAILABILITY_INVALID");
  if (typeof input.headline !== "string" || !input.headline.trim()) issues.push("HEADLINE_MISSING");
  if (typeof input.change_summary !== "string" || !input.change_summary.trim()) issues.push("SUMMARY_MISSING");
  if (!isOfficialUrl(provider, input.source_url)) issues.push("SOURCE_NOT_OFFICIAL_HTTPS");
  if (!Array.isArray(input.evidence_urls) || input.evidence_urls.length === 0
    || input.evidence_urls.some((url) => !isOfficialUrl(provider, url))) {
    issues.push("EVIDENCE_URLS_INVALID");
  }
  if (input.published_at !== null && !isIsoDate(input.published_at)) issues.push("PUBLISHED_AT_INVALID");
  if (!isIsoDate(input.observed_at)) issues.push("OBSERVED_AT_INVALID");
  if (input.effective_at !== null && !isIsoDate(input.effective_at)) issues.push("EFFECTIVE_AT_INVALID");
  if (input.previous_state !== null && typeof input.previous_state !== "string") issues.push("PREVIOUS_STATE_INVALID");
  if (typeof input.new_state !== "string" || !input.new_state.trim()) issues.push("NEW_STATE_MISSING");
  if (!new Set(["COMPLETE", "PARTIAL", "FAILED"]).has(input.source_coverage as string)) issues.push("SOURCE_COVERAGE_INVALID");
  if (!isRecord(input.project_impacts) || ["fcr", "chief", "solcontinuity", "promptos"].some((key) => typeof input.project_impacts?.[key] !== "string")) issues.push("PROJECT_IMPACTS_INVALID");
  if (typeof input.safe_test !== "string" || !input.safe_test.trim()) issues.push("SAFE_TEST_MISSING");
  if (typeof input.event_fingerprint !== "string" || !HASH.test(input.event_fingerprint)) {
    issues.push("FINGERPRINT_INVALID");
  } else if (
    typeof input.category === "string"
    && typeof input.headline === "string"
    && typeof input.change_summary === "string"
    && typeof input.source_url === "string"
    && typeof input.availability === "string"
    && (input.published_at === null || typeof input.published_at === "string")
    && typeof input.observed_at === "string"
    && typeof input.new_state === "string"
    && (input.previous_state === null || typeof input.previous_state === "string")
    && (input.effective_at === null || typeof input.effective_at === "string")
    && (input.source_coverage === "COMPLETE" || input.source_coverage === "PARTIAL" || input.source_coverage === "FAILED")
    && CATEGORIES.has(input.category as ProviderChangeCategory)
    && AVAILABILITY.has(input.availability as ProviderChangeAvailability)
  ) {
    const expected = fingerprintProviderChangeEvent({
      provider,
      category: input.category as ProviderChangeCategory,
      headline: input.headline,
      change_summary: input.change_summary,
      availability: input.availability as ProviderChangeAvailability,
      source_url: input.source_url,
      published_at: input.published_at as string | null,
      observed_at: input.observed_at,
      effective_at: input.effective_at as string | null,
      previous_state: input.previous_state as string | null,
      new_state: input.new_state,
      source_coverage: input.source_coverage as "COMPLETE" | "PARTIAL" | "FAILED",
      project_impacts: input.project_impacts as ProviderChangeEvent["project_impacts"],
      safe_test: input.safe_test as string,
    });
    if (input.event_fingerprint !== expected) issues.push("FINGERPRINT_MISMATCH");
  }
  return issues;
}

export function assessProviderChangeContinuity(
  input: unknown,
  priorFingerprints: string[] = [],
  now: string,
): ProviderChangeContinuityAssessment {
  const reasons = validateProviderChangeEvent(input);
  if (reasons.length > 0 || !isRecord(input)) {
    return { status: "INVALID", fingerprint: null, reasons, evidence_only: true, execution_authorized: false };
  }
  const fingerprint = input.event_fingerprint as string;
  const observedAt = Date.parse(input.observed_at as string);
  const nowAt = Date.parse(now);
  if (!Number.isFinite(nowAt) || observedAt > nowAt) {
    return {
      status: "INVALID", fingerprint, reasons: ["TIME_ORDER_INVALID"],
      evidence_only: true, execution_authorized: false,
    };
  }
  if (nowAt - observedAt > MAX_AGE_MS) {
    return {
      status: "STALE", fingerprint, reasons: ["OBSERVATION_OLDER_THAN_TWO_HOURS"],
      evidence_only: true, execution_authorized: false,
    };
  }
  if (priorFingerprints.includes(fingerprint)) {
    return {
      status: "DUPLICATE", fingerprint, reasons: ["FINGERPRINT_ALREADY_OBSERVED"],
      evidence_only: true, execution_authorized: false,
    };
  }
  return { status: "NEW", fingerprint, reasons: [], evidence_only: true, execution_authorized: false };
}
