// Probe execution for audit_change's live-proof path: given a running target and a probe spec, make
// the real HTTP request and return a captured Probe (a complete exchange the auditor can judge).
//
// SSRF note: this makes the server issue an HTTP request to a caller-supplied URL. It is intended for
// the self-hosted / local "as-you-code" case (the agent probing its own dev server) and is only
// reachable through the token-gated /mcp on a deploy. We restrict the scheme to http/https; a hardened
// multi-tenant deployment should additionally host-allowlist the target.
import type { Probe } from "./auditor.js";

export interface ProbeSpec {
  label: string;
  auth_context: "unauthenticated" | "wrong-tenant" | "non-admin" | "authorized";
  expected: "deny" | "allow";
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function resolveUrl(baseUrl: string, p: string): string {
  const url = new URL(p, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("target_base_url must be http or https");
  }
  return url.toString();
}

export async function executeProbe(baseUrl: string, spec: ProbeSpec, timeoutMs = 5000): Promise<Probe> {
  const url = resolveUrl(baseUrl, spec.path);
  const method = (spec.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (spec.body != null && method !== "GET" && method !== "HEAD") {
    init.body = typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body);
    headers["content-type"] = headers["content-type"] ?? "application/json";
  }
  let status = 0;
  let body: unknown = null;
  try {
    const r = await fetch(url, init);
    status = r.status;
    body = await r.json().catch(() => null);
  } catch {
    /* unreachable target / timeout → status 0, caller sees INCONCLUSIVE */
  }
  return {
    label: spec.label,
    auth_context: spec.auth_context,
    expected: spec.expected,
    // The Authorization value is redacted deep in seal_evidence before hashing/storing.
    request: { method, url, headers, body: spec.body ?? null },
    response: { status, headers: {}, body },
  };
}
