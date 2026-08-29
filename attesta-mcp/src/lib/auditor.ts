// audit_finding — the independent auditor. "The writer is never its own verifier."
//
// Two layers, Qodo-style (rubric-driven, structured, evidence-linked findings):
//   1. Deterministic checks — objective consistency between the captured evidence and the verdict.
//      If these fail, the model is never called (cheap) and auditor_ok is false.
//   2. A single call to a DIFFERENT model family (default z-ai/glm-5.3-flash while main is DeepSeek)
//      that judges, against an explicit rubric, whether the evidence genuinely supports the verdict.
// auditor_ok is true only if BOTH agree. The main agent may not seal or post until auditor_ok.

import type { ModelCall } from "./openrouter.js";

export interface AuditRequest {
  method: string;
  url?: string;
  path?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}
export interface AuditResponse {
  status: number;
  headers?: Record<string, unknown>;
  body?: unknown;
}
export interface AuditFindingInput {
  verdict: "EXPLOITED" | "CLEAN";
  route: string | null;
  request: AuditRequest;
  response: AuditResponse;
}

export interface AuditCheck {
  criterion: string;
  pass: boolean;
  note: string;
}
export interface AuditResult {
  auditor_ok: boolean;
  reason: string;
  checks: AuditCheck[];
  model: string;
}

function bodyHasData(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === "string") return body.trim().length > 0;
  if (Array.isArray(body)) return body.length > 0;
  if (typeof body === "object") return Object.keys(body).length > 0;
  return true;
}

// Objective, model-free consistency rubric. Every returned check is a hard gate.
export function deterministicChecks(f: AuditFindingInput): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const hasReq = Boolean(f.request?.method && (f.request.url ?? f.request.path));
  checks.push({ criterion: "request captured (method + path/url)", pass: hasReq, note: hasReq ? "ok" : "missing request" });
  const hasResp = typeof f.response?.status === "number";
  checks.push({ criterion: "response captured (status present)", pass: hasResp, note: hasResp ? `status ${f.response?.status}` : "missing response" });

  if (f.verdict === "EXPLOITED") {
    const is2xx = hasResp && f.response.status >= 200 && f.response.status < 300;
    checks.push({ criterion: "EXPLOITED → response is 2xx", pass: is2xx, note: `status ${f.response?.status}` });
    const hasData = bodyHasData(f.response.body);
    checks.push({ criterion: "EXPLOITED → response returned a data body", pass: hasData, note: hasData ? "non-empty" : "empty body" });
  } else {
    const rejected = hasResp && (f.response.status === 401 || f.response.status === 403);
    checks.push({ criterion: "CLEAN → response rejected (401/403)", pass: rejected, note: `status ${f.response?.status}` });
  }
  return checks;
}

const RUBRIC = `You are an independent security auditor. You did NOT produce the finding you are reviewing; your job is to confirm or reject it from the captured evidence alone.

You are given a JSON object: { verdict, route, request, response } for a broken-access-control check.

Apply this rubric and be strict:
- EXPLOITED is correct ONLY if the response is a 2xx that returned data the request should not have been allowed to see (e.g. an unauthenticated or wrong-tenant/wrong-role request receiving protected data).
- CLEAN is correct ONLY if the response correctly rejected the request (401/403) — i.e. access control was enforced.
- If the evidence is incomplete or does not clearly support the verdict, reject it.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"ok": <true|false>, "reason": "<one sentence>", "checks": [{"criterion": "<text>", "pass": <true|false>, "note": "<text>"}]}`;

interface ModelJudgment {
  ok: boolean;
  reason: string;
  checks: AuditCheck[];
}

function parseJudgment(raw: string): ModelJudgment {
  // Tolerate ```json fences / surrounding prose: grab the first {...} block.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("auditor model did not return JSON");
  const parsed = JSON.parse(match[0]) as Partial<ModelJudgment>;
  if (typeof parsed.ok !== "boolean") throw new Error("auditor JSON missing boolean 'ok'");
  return {
    ok: parsed.ok,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    checks: Array.isArray(parsed.checks) ? (parsed.checks as AuditCheck[]) : [],
  };
}

export async function auditFinding(
  finding: AuditFindingInput,
  modelCall: ModelCall,
  model: string,
): Promise<AuditResult> {
  const checks = deterministicChecks(finding);
  const deterministicOk = checks.every((c) => c.pass);
  if (!deterministicOk) {
    const failed = checks.filter((c) => !c.pass).map((c) => c.criterion).join("; ");
    return { auditor_ok: false, reason: `evidence does not support ${finding.verdict}: ${failed}`, checks, model };
  }

  let judgment: ModelJudgment;
  try {
    const raw = await modelCall(RUBRIC, JSON.stringify(finding));
    judgment = parseJudgment(raw);
  } catch (err) {
    // Fail closed: if the independent model cannot confirm, we do NOT approve.
    return {
      auditor_ok: false,
      reason: `independent auditor unavailable: ${err instanceof Error ? err.message : String(err)}`,
      checks,
      model,
    };
  }

  return {
    auditor_ok: judgment.ok,
    reason: judgment.reason || (judgment.ok ? "auditor confirmed" : "auditor rejected"),
    checks: [...checks, ...judgment.checks],
    model,
  };
}
