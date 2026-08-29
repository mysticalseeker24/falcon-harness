// The ONE canonicalization function for the ledger. Object keys are sorted recursively so the same
// logical entry always serializes to the same bytes (CONVENTIONS §5). Never hand-serialize a
// ledger entry anywhere else — every hash AND every persisted row goes through here.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    // Null-prototype accumulator: a "__proto__" key is stored as a normal own property (not the
    // prototype), so attacker-controlled __proto__ data is represented in the canonical output and
    // cannot change ledger contents without changing the hash.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}
