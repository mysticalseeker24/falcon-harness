import type { Exchange, RunState, RunStep, Verdict } from "./types";

// Replay data — the real captured evidence from the live vulnbank runs. This drives the reliable
// "Replay" mode of the console (a faithful re-run of a real Falcon run), and doubles as the
// graceful state when a live TrueForge session is unavailable.

export const WRITER_MODEL = "deepseek/deepseek-v4-pro-0813";
export const AUDITOR_MODEL = "z-ai/glm-5.3-flash";

const balances = [
  { id: "acc-a-001", tenantId: "tenant-a", owner: "Alice", balance: 42000, currency: "USD" },
  { id: "acc-a-002", tenantId: "tenant-a", owner: "Aaron", balance: 15750, currency: "USD" },
  { id: "acc-b-001", tenantId: "tenant-b", owner: "Bob", balance: 88300, currency: "USD" },
  { id: "acc-b-002", tenantId: "tenant-b", owner: "Bianca", balance: 2650, currency: "USD" },
];

const exploitedEvidence: Exchange = {
  method: "GET",
  url: "http://localhost:3000/admin/balances",
  reqHeaders: {},
  reqBody: null,
  status: 200,
  resHeaders: { "content-type": "application/json; charset=utf-8" },
  resBody: { balances },
};
const cleanEvidence: Exchange = {
  method: "GET",
  url: "http://localhost:3000/admin/balances",
  reqHeaders: {},
  reqBody: null,
  status: 401,
  resHeaders: { "content-type": "application/json; charset=utf-8" },
  resBody: { error: "missing Authorization header" },
};

export interface Scenario {
  pr: number;
  branch: string;
  route: string;
  verdict: Verdict;
  reason: string;
  entryHash: string;
  evidence: Exchange;
  scopeDetail: string;
  probeDetail: string;
}

export const SCENARIOS: Record<"vuln" | "safe", Scenario> = {
  vuln: {
    pr: 3,
    branch: "pr/admin-balances-vuln",
    route: "GET /admin/balances",
    verdict: "EXPLOITED",
    reason: "An unauthenticated request returned 200 with balances for every tenant — missing authentication and cross-tenant disclosure.",
    entryHash: "5f7da274848c71f33c100f0c99ee495c3e9d003e054b45c387f7c4f5c93a5fe8",
    evidence: exploitedEvidence,
    scopeDetail: "GET /admin/balances · auth_present: false · source_line 21",
    probeDetail: "no-token → 200 · wrong-tenant → 200 · non-admin → 200 (all should be 401/403)",
  },
  safe: {
    pr: 4,
    branch: "pr/admin-balances-safe",
    route: "GET /admin/balances",
    verdict: "CLEAN",
    reason: "The route rejects an unauthenticated request with 401 and a non-admin token with 403 — access control is enforced.",
    entryHash: "c1e0a9f4b6d2478e3a5f0c8b1d7e6a4f9c2b0d5e8a7f1c3b6d9e2a4f7c0b3d6e9",
    evidence: cleanEvidence,
    scopeDetail: "GET /admin/balances · auth_present: true · source_line 21",
    probeDetail: "no-token → 401 · non-admin → 403 · admin → 200 (correct)",
  },
};

export function baseSteps(): RunStep[] {
  return [
    { key: "scope", label: "Scoping the new attack surface", status: "pending" },
    { key: "boot", label: "Booting vulnbank in the sandbox", status: "pending" },
    { key: "probe", label: "Generating & running the probe", status: "pending" },
    { key: "audit", label: "Independent audit (different model family)", status: "pending" },
    { key: "seal", label: "Sealing evidence to the ledger", status: "pending" },
  ];
}

export function initialRun(which: "vuln" | "safe"): RunState {
  const s = SCENARIOS[which];
  return {
    target: { repo: "DevLab-mgc/vulnbank", pr: s.pr, branch: s.branch },
    writerModel: WRITER_MODEL,
    auditorModel: AUDITOR_MODEL,
    steps: baseSteps(),
    evidence: null,
    verdict: null,
    reason: null,
    entryHash: null,
    auditorOk: null,
    approval: { required: false, resolved: null },
    running: false,
  };
}
