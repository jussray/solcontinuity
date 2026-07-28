export class ResilienceError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "ResilienceError";
  }
}

export class QuorumError extends ResilienceError {
  public constructor(
    message: string,
    public readonly evidence: unknown
  ) {
    super(message, "QUORUM_NOT_REACHED");
    this.name = "QuorumError";
  }
}

export class ManifestValidationError extends ResilienceError {
  public constructor(public readonly issues: readonly string[]) {
    super(`Manifest validation failed with ${issues.length} issue(s).`, "INVALID_MANIFEST");
    this.name = "ManifestValidationError";
  }
}
