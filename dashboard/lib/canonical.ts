// Canonical JSON serializer — a byte-for-byte copy of the ONE serializer in
// `attesta-mcp/src/lib/canonicalJson.ts` (CONVENTIONS §5). That file is the source of truth; this
// vendored copy exists only so the dashboard can persist the demo tamper fixture through the same
// canonicalization instead of a raw `JSON.stringify`. If the attesta serializer ever changes, change
// it here too (the ledger test asserts the two agree on a fixed vector).
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    // Null-prototype accumulator so a "__proto__" key is stored as data, not the prototype.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}
