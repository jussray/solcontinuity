import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RedisSessionRevocationStore } from "../src/api/redis-session-revocation.js";

const DIGEST = createHash("sha256").update("unit-only-digest").digest("hex");

test("Redis revocation adapter rejects unencrypted remote URLs", () => {
  assert.throws(() => new RedisSessionRevocationStore({ url: "redis://redis.example.org:6379" }), /REMOTE_REDIS_TLS_REQUIRED/);
  assert.throws(() => new RedisSessionRevocationStore({ url: "https://127.0.0.1:6379" }), /INVALID_REDIS_SCHEME/);
  assert.throws(() => new RedisSessionRevocationStore({ url: "redis://127.0.0.1:6379/4" }), /UNSUPPORTED_REDIS_URL_PARAMETERS/);
});

test("Redis revocation adapter rejects invalid digests without connecting", async () => {
  const store = new RedisSessionRevocationStore({ url: "redis://127.0.0.1:1", timeoutMs: 300 });
  await assert.rejects(() => store.isRevoked("raw-session-value"), /INVALID_SESSION_DIGEST/);
  await assert.rejects(() => store.revoke("not-a-hash", Date.now() + 1000), /INVALID_SESSION_DIGEST/);
});

test("Redis revocation adapter rejects malformed storage options", () => {
  assert.throws(() => new RedisSessionRevocationStore({ url: "redis://127.0.0.1", prefix: "../private" }), /INVALID_REDIS_PREFIX/);
  assert.throws(() => new RedisSessionRevocationStore({ url: "redis://127.0.0.1", timeoutMs: 2 }), /INVALID_REDIS_TIMEOUT/);
  assert.throws(() => new RedisSessionRevocationStore({ url: "redis://username@127.0.0.1" }), /REDIS_USERNAME_REQUIRES_PASSWORD/);
});

test("Redis revocation adapter fails closed without a reachable service", async () => {
  const store = new RedisSessionRevocationStore({ url: "redis://127.0.0.1:1", timeoutMs: 300 });
  await assert.rejects(() => store.isRevoked(DIGEST), /REDIS_REVOCATION_UNAVAILABLE/);
  await assert.rejects(() => store.revoke(DIGEST, Date.now() + 60_000), /REDIS_REVOCATION_UNAVAILABLE/);
});
