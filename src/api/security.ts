import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEVICE_COOKIE_NAME = "sc_device";
const SESSION_COOKIE_NAME = "sc_session";
const DEVICE_ID_BYTES = 16;
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export type CookieJar = Readonly<Record<string, string>>;

export interface CookieOptions {
  readonly maxAgeSeconds?: number;
  readonly path?: string;
  readonly secure?: boolean;
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly httpOnly?: boolean;
}

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly setCookie?: string;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export function parseCookies(header: string | undefined): CookieJar {
  const jar: Record<string, string> = {};
  if (!header) {
    return jar;
  }
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      jar[name] = decodeURIComponent(rawValue);
    } catch {
      jar[name] = rawValue;
    }
  }
  return jar;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  segments.push(`SameSite=${options.sameSite ?? "Strict"}`);
  if (options.httpOnly !== false) {
    segments.push("HttpOnly");
  }
  if (options.secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

export function clearedCookie(name: string, options: Pick<CookieOptions, "path" | "secure" | "sameSite"> = {}): string {
  return serializeCookie(name, "", { ...options, maxAgeSeconds: 0 });
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.byteLength !== bufferB.byteLength) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signValue(secret: string, value: string): string {
  return `${value}.${sign(secret, value)}`;
}

export function verifySignedValue(secret: string, signed: string): string | null {
  const separatorIndex = signed.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }
  const value = signed.slice(0, separatorIndex);
  const signature = signed.slice(separatorIndex + 1);
  return timingSafeStringEqual(signature, sign(secret, value)) ? value : null;
}

export function timingSafeTokenEqual(provided: string, expected: string): boolean {
  return timingSafeStringEqual(provided, expected);
}

export function resolveDeviceIdentity(cookies: CookieJar, secret: string, secureCookies: boolean): DeviceIdentity {
  const existing = cookies[DEVICE_COOKIE_NAME];
  const verified = existing ? verifySignedValue(secret, existing) : null;
  if (verified) {
    return { deviceId: verified };
  }
  const deviceId = randomBytes(DEVICE_ID_BYTES).toString("base64url");
  return {
    deviceId,
    setCookie: serializeCookie(DEVICE_COOKIE_NAME, signValue(secret, deviceId), {
      maxAgeSeconds: DEVICE_COOKIE_MAX_AGE_SECONDS,
      sameSite: "Strict",
      httpOnly: true,
      secure: secureCookies
    })
  };
}

/**
 * Combines the device cookie with network identity so clearing the cookie alone
 * (without also changing source IP) does not reset abuse-rate-limit state.
 */
export function computeFingerprint(deviceId: string, remoteAddress: string, userAgent: string | undefined): string {
  return createHash("sha256")
    .update(deviceId)
    .update("\u0000")
    .update(remoteAddress)
    .update("\u0000")
    .update(userAgent ?? "")
    .digest("hex");
}

export class FingerprintRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly maxTrackedFingerprints = 10_000
  ) {}

  consume(fingerprint: string, cost = 1, now = Date.now()): RateLimitDecision {
    this.prune();
    let bucket = this.buckets.get(fingerprint);
    if (!bucket) {
      bucket = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(fingerprint, bucket);
    }
    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.updatedAt = now;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true };
    }
    const deficit = cost - bucket.tokens;
    const retryAfterSeconds = Math.max(1, Math.ceil(deficit / this.refillPerSecond));
    return { allowed: false, retryAfterSeconds };
  }

  private prune(): void {
    if (this.buckets.size <= this.maxTrackedFingerprints) {
      return;
    }
    const entries = [...this.buckets.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt);
    const excess = entries.length - this.maxTrackedFingerprints;
    for (let index = 0; index < excess; index += 1) {
      this.buckets.delete(entries[index]![0]);
    }
  }
}

export function createSessionCookie(secret: string, secureCookies: boolean, now = Date.now()): string {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  return serializeCookie(SESSION_COOKIE_NAME, signValue(secret, String(expiresAt)), {
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    sameSite: "Strict",
    httpOnly: true,
    secure: secureCookies
  });
}

export function clearSessionCookie(secureCookies: boolean): string {
  return clearedCookie(SESSION_COOKIE_NAME, { sameSite: "Strict", secure: secureCookies });
}

export function hasValidSession(cookies: CookieJar, secret: string, now = Date.now()): boolean {
  const cookie = cookies[SESSION_COOKIE_NAME];
  if (!cookie) {
    return false;
  }
  const verified = verifySignedValue(secret, cookie);
  if (!verified) {
    return false;
  }
  const expiresAt = Number(verified);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
