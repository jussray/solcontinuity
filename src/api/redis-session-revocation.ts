import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { SessionRevocationStore } from "./session-revocation.js";

export interface RedisSessionRevocationOptions {
  /** Use rediss:// for remote hosts. Plain redis:// is limited to loopback. */
  readonly url: string;
  readonly prefix?: string;
  readonly timeoutMs?: number;
}

type RedisReply = { readonly kind: "simple" | "integer"; readonly value: string };

const DIGEST = /^[0-9a-f]{64}$/;
const PREFIX = /^[a-zA-Z0-9:_-]{1,72}$/;
const MAX_REPLY_BYTES = 4096;

function wire(args: readonly string[]): Buffer {
  const buffers: Buffer[] = [Buffer.from("*" + args.length + "\r\n")];
  for (const value of args) {
    const bytes = Buffer.from(value, "utf8");
    buffers.push(Buffer.from("$" + bytes.length + "\r\n"), bytes, Buffer.from("\r\n"));
  }
  return Buffer.concat(buffers);
}

/**
 * One short-lived connection per command, so no shared pending command queue
 * can mix results across concurrent HTTP requests. Redis RESP2 scalar replies
 * only; fail closed on unknown replies, timeouts and connection errors.
 */
async function requestRedis(
  host: string,
  port: number,
  tlsEnabled: boolean,
  auth: readonly string[] | null,
  command: readonly string[],
  timeoutMs: number
): Promise<RedisReply> {
  const socket: Socket | TLSSocket = tlsEnabled
    ? connectTls({ host, port, servername: host, rejectUnauthorized: true })
    : createConnection({ host, port });
  const operations = auth ? [wire(auth), wire(command)] : [wire(command)];
  try {
    return await new Promise<RedisReply>((resolve, reject) => {
      let settled = false;
      let sent = 0;
      let pending = Buffer.alloc(0);
      const failure = (): void => {
        if (settled) return;
        settled = true;
        reject(new Error("REDIS_REVOCATION_UNAVAILABLE"));
      };
      const success = (reply: RedisReply): void => {
        if (settled) return;
        settled = true;
        resolve(reply);
      };
      const sendNext = (): void => {
        if (sent >= operations.length) return;
        socket.write(operations[sent++]!);
      };
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error("REDIS_TIMEOUT")));
      socket.once(tlsEnabled ? "secureConnect" : "connect", sendNext);
      socket.on("error", failure);
      socket.on("close", failure);
      socket.on("data", (chunk: Buffer) => {
        if (settled) return;
        pending = Buffer.concat([pending, chunk]);
        if (pending.length > MAX_REPLY_BYTES) { failure(); return; }
        while (!settled) {
          const pos = pending.indexOf("\r\n");
          if (pos < 0) break;
          const line = pending.subarray(0, pos).toString("utf8");
          pending = pending.subarray(pos + 2);
          const prefix = line.slice(0, 1);
          if (prefix !== "+" && prefix !== ":") { failure(); return; }
          const reply: RedisReply = {
            kind: prefix === "+" ? "simple" : "integer",
            value: line.slice(1)
          };
          if (sent < operations.length) {
            if (reply.kind !== "simple" || reply.value !== "OK") { failure(); return; }
            sendNext();
          } else {
            success(reply);
          }
        }
      });
    });
  } finally {
    socket.destroy();
  }
}

export class RedisSessionRevocationStore implements SessionRevocationStore {
  private readonly host: string;
  private readonly port: number;
  private readonly tlsEnabled: boolean;
  private readonly auth: readonly string[] | null;
  private readonly prefix: string;
  private readonly timeoutMs: number;

  constructor(options: RedisSessionRevocationOptions) {
    const uri = new URL(options.url);
    if (uri.protocol !== "redis:" && uri.protocol !== "rediss:") {
      throw new Error("INVALID_REDIS_SCHEME");
    }
    if (uri.hash || uri.search || (uri.pathname !== "" && uri.pathname !== "/" && uri.pathname !== "/0")) {
      throw new Error("UNSUPPORTED_REDIS_URL_PARAMETERS");
    }
    const host = uri.hostname.replace(/^\[|\]$/g, "");
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (uri.protocol === "redis:" && !loopback) {
      throw new Error("REMOTE_REDIS_TLS_REQUIRED");
    }
    const port = uri.port === "" ? 6379 : Number(uri.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("INVALID_REDIS_HOST_OR_PORT");
    }
    const prefix = options.prefix ?? "solcontinuity:revoked:";
    if (!PREFIX.test(prefix)) throw new Error("INVALID_REDIS_PREFIX");
    const timeoutMs = options.timeoutMs ?? 2000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) {
      throw new Error("INVALID_REDIS_TIMEOUT");
    }
    const username = decodeURIComponent(uri.username);
    const password = decodeURIComponent(uri.password);
    if (username && !password) throw new Error("REDIS_USERNAME_REQUIRES_PASSWORD");
    this.auth = password ? (username ? ["AUTH", username, password] : ["AUTH", password]) : null;
    this.host = host;
    this.port = port;
    this.tlsEnabled = uri.protocol === "rediss:";
    this.prefix = prefix;
    this.timeoutMs = timeoutMs;
  }

  private key(digest: string): string {
    if (!DIGEST.test(digest)) throw new Error("INVALID_SESSION_DIGEST");
    return this.prefix + digest;
  }

  async isRevoked(digest: string): Promise<boolean> {
    const reply = await requestRedis(
      this.host, this.port, this.tlsEnabled, this.auth,
      ["EXISTS", this.key(digest)], this.timeoutMs
    );
    if (reply.kind !== "integer" || (reply.value !== "0" && reply.value !== "1")) {
      throw new Error("REDIS_REVOCATION_INVALID_RESPONSE");
    }
    return reply.value === "1";
  }

  async revoke(digest: string, expiresAt: number): Promise<void> {
    const key = this.key(digest);
    if (!Number.isSafeInteger(expiresAt)) throw new Error("INVALID_SESSION_EXPIRATION");
    if (expiresAt <= Date.now()) return;
    // PXAT is an absolute Redis-server expiry (Redis >= 6.2).
    const reply = await requestRedis(
      this.host, this.port, this.tlsEnabled, this.auth,
      ["SET", key, "1", "PXAT", String(expiresAt)], this.timeoutMs
    );
    if (reply.kind !== "simple" || reply.value !== "OK") {
      throw new Error("REDIS_REVOCATION_WRITE_FAILED");
    }
  }
}
