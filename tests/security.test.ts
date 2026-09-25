import assert from "node:assert/strict";
import test from "node:test";
import {
  FingerprintRateLimiter,
  clearSessionCookie,
  computeFingerprint,
  createSessionCookie,
  hasValidSession,
  parseCookies,
  resolveDeviceIdentity,
  serializeCookie,
  signValue,
  timingSafeTokenEqual,
  verifySignedValue
} from "../src/api/security.js";

test("parseCookies splits a cookie header into a jar", () => {
  const jar = parseCookies("sc_device=abc; sc_session=def%20ghi");
  assert.equal(jar.sc_device, "abc");
  assert.equal(jar.sc_session, "def ghi");
});

test("parseCookies tolerates an absent header", () => {
  assert.deepEqual(parseCookies(undefined), {});
});

test("signValue and verifySignedValue round-trip and reject tampering", () => {
  const signed = signValue("secret-a", "payload");
  assert.equal(verifySignedValue("secret-a", signed), "payload");
  assert.equal(verifySignedValue("secret-b", signed), null);
  assert.equal(verifySignedValue("secret-a", `${signed}x`), null);
  assert.equal(verifySignedValue("secret-a", "not-signed"), null);
});

test("serializeCookie sets HttpOnly and SameSite=Strict by default", () => {
  const cookie = serializeCookie("name", "value");
  assert.match(cookie, /^name=value; Path=\/; SameSite=Strict; HttpOnly$/);
});

test("serializeCookie honors Secure and Max-Age", () => {
  const cookie = serializeCookie("name", "value", { maxAgeSeconds: 60, secure: true });
  assert.match(cookie, /Max-Age=60/);
  assert.match(cookie, /Secure/);
});

test("resolveDeviceIdentity issues a new signed cookie when none is present", () => {
  const identity = resolveDeviceIdentity({}, "cookie-secret", false);
  assert.ok(identity.deviceId.length > 0);
  assert.ok(identity.setCookie?.includes("sc_device="));
});

test("resolveDeviceIdentity trusts a previously issued signed cookie", () => {
  const issued = resolveDeviceIdentity({}, "cookie-secret", false);
  const cookieValue = issued.setCookie!.split(";")[0]!.split("=")[1]!;
  const resolved = resolveDeviceIdentity({ sc_device: decodeURIComponent(cookieValue) }, "cookie-secret", false);
  assert.equal(resolved.deviceId, issued.deviceId);
  assert.equal(resolved.setCookie, undefined);
});

test("resolveDeviceIdentity reissues a fresh device id when the cookie is forged", () => {
  const resolved = resolveDeviceIdentity({ sc_device: "forged.signature" }, "cookie-secret", false);
  assert.ok(resolved.setCookie);
});

test("computeFingerprint is stable for identical inputs and differs otherwise", () => {
  const a = computeFingerprint("device-1", "127.0.0.1", "agent-a");
  const b = computeFingerprint("device-1", "127.0.0.1", "agent-a");
  const c = computeFingerprint("device-2", "127.0.0.1", "agent-a");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("timingSafeTokenEqual compares tokens correctly", () => {
  assert.equal(timingSafeTokenEqual("abc", "abc"), true);
  assert.equal(timingSafeTokenEqual("abc", "abcd"), false);
  assert.equal(timingSafeTokenEqual("abc", "xyz"), false);
});

test("FingerprintRateLimiter allows bursts up to capacity then denies", () => {
  const limiter = new FingerprintRateLimiter(3, 1);
  const now = 1_000_000;
  assert.equal(limiter.consume("fp", 1, now).allowed, true);
  assert.equal(limiter.consume("fp", 1, now).allowed, true);
  assert.equal(limiter.consume("fp", 1, now).allowed, true);
  const denied = limiter.consume("fp", 1, now);
  assert.equal(denied.allowed, false);
  assert.ok((denied.retryAfterSeconds ?? 0) >= 1);
});

test("FingerprintRateLimiter refills tokens over time", () => {
  const limiter = new FingerprintRateLimiter(1, 1);
  const now = 2_000_000;
  assert.equal(limiter.consume("fp", 1, now).allowed, true);
  assert.equal(limiter.consume("fp", 1, now).allowed, false);
  assert.equal(limiter.consume("fp", 1, now + 1_500).allowed, true);
});

test("FingerprintRateLimiter tracks fingerprints independently", () => {
  const limiter = new FingerprintRateLimiter(1, 1);
  const now = 3_000_000;
  assert.equal(limiter.consume("fp-a", 1, now).allowed, true);
  assert.equal(limiter.consume("fp-b", 1, now).allowed, true);
});

test("session cookie round-trips through hasValidSession and expires", () => {
  const now = 4_000_000;
  const cookie = createSessionCookie("cookie-secret", false, now);
  const cookieValue = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
  assert.equal(hasValidSession({ sc_session: cookieValue }, "cookie-secret", now + 1_000), true);
  assert.equal(hasValidSession({ sc_session: cookieValue }, "cookie-secret", now + 13 * 60 * 60 * 1000), false);
  assert.equal(hasValidSession({ sc_session: cookieValue }, "wrong-secret", now + 1_000), false);
  assert.equal(hasValidSession({}, "cookie-secret", now), false);
});

test("clearSessionCookie expires immediately", () => {
  const cookie = clearSessionCookie(false);
  assert.match(cookie, /Max-Age=0/);
});
