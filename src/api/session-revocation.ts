/**
 * Only opaque SHA-256 digests belong in a revocation store. Never persist or
 * log session cookie values. Keys expire at the signed cookie's expiration.
 */
export interface SessionRevocationStore {
  isRevoked(digest: string): Promise<boolean>;
  revoke(digest: string, expiresAt: number): Promise<void>;
}

/**
 * Single-process fallback; not durable across restarts or other instances.
 * Production multi-instance users must inject a shared implementation.
 */
export class ProcessLocalSessionRevocationStore implements SessionRevocationStore {
  private readonly revoked = new Map<string, number>();

  async isRevoked(digest: string): Promise<boolean> {
    const expiresAt = this.revoked.get(digest);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.revoked.delete(digest);
      return false;
    }
    return true;
  }

  async revoke(digest: string, expiresAt: number): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("INVALID_SESSION_DIGEST");
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return;
    for (const [key, expires] of this.revoked) {
      if (expires <= Date.now()) this.revoked.delete(key);
    }
    this.revoked.set(digest, expiresAt);
  }
}
