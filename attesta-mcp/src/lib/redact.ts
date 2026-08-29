// Redact credential-bearing fields ANYWHERE in the evidence — request or response, at any depth
// (headers, nested request/response objects, cookies). The ledger records the FACT that a token
// was present, never the token itself (CONVENTIONS §1.4).
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|api-key|access[_-]?token|refresh[_-]?token|password|secret)$/i;
const REDACTED = "***REDACTED***";

// Deep-clone the value with every sensitive key's value replaced. Non-objects pass through.
export function redactDeep<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(walk);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : walk(source[key]);
    }
    return out;
  }
  return value;
}
