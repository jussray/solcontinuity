function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalize(nested)] as const);

    return Object.fromEntries(entries);
  }

  return value;
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}
