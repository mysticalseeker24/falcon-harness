// Redact credential-bearing headers before anything is stored or hashed. The ledger records the
// FACT that a token was present, never the token itself (CONVENTIONS §1.4).
const SENSITIVE_HEADER = /^(authorization|cookie|proxy-authorization|x-api-key)$/i;
const REDACTED = "***REDACTED***";

export function redactRequest(request: unknown): unknown {
  if (request === null || typeof request !== "object") return request;
  const clone = structuredClone(request) as Record<string, unknown>;
  const headers = clone.headers;
  if (headers !== null && typeof headers === "object") {
    const h = headers as Record<string, unknown>;
    for (const key of Object.keys(h)) {
      if (SENSITIVE_HEADER.test(key)) h[key] = REDACTED;
    }
  }
  return clone;
}
