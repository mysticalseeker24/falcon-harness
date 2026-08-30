// bench — the product's own test of its headline claim.
//
// For each vulnbank demo branch, ×3: boot the REAL fixture, probe it over HTTP, run the REAL
// attesta-mcp pipeline (scope_surface on the diff → derive the verdict from the probes → audit +
// seal the evidence on a different model family → verify the ledger), and check the verdict.
// Prints a matrix, records a result artifact under bench-results/, and EXITS NON-ZERO if any verdict
// is wrong. No asserted numbers — only measured.
//
// Reproducibility: scenarios and the diff baseline are pinned to immutable commit SHAs (branches
// move; SHAs do not), so a rerun measures exactly the same code.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scopeSurface } from "./src/lib/scopeSurface.js";
import { sealEvidence, verifyLedger } from "./src/lib/ledger.js";
import { auditFinding, type AuditFindingInput, type Probe } from "./src/lib/auditor.js";
import { makeOpenRouterCall } from "./src/lib/openrouter.js";
import { LocalArtifactStore, LocalLedgerStore } from "./src/storage/local.js";

const REPO = "https://github.com/DevLab-mgc/vulnbank.git";
const RUNS = 3;
const PORT = 3999;
const AUDITOR_MODEL = process.env.AUDITOR_MODEL ?? "z-ai/glm-5.3-flash";
const WRITER_MODEL = process.env.WRITER_MODEL ?? "deepseek/deepseek-v4-pro-0813";
const RESULTS_DIR = path.resolve(process.cwd(), "bench-results");

// Pinned immutable revisions (see `git ls-remote` on DevLab-mgc/vulnbank). BASE is the diff baseline.
const BASE_SHA = "da7b2d4c59bc3e54122c775a6dada535b16bb7f7"; // vulnbank main
const SCENARIOS = [
  { name: "vuln", branch: "pr/admin-balances-vuln", sha: "68cd31e2d88e97e363798119fc61cd7eab446558", pr: 3, expect: "EXPLOITED" as const },
  { name: "safe", branch: "pr/admin-balances-safe", sha: "a0cd8ca150336322fa518b10c76329d1ef06f859", pr: 4, expect: "CLEAN" as const },
];

type Verdict = "EXPLOITED" | "CLEAN" | "INCONCLUSIVE";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openrouterKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.resolve(process.cwd(), "../.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return "";
}

// Keep detailed diagnostics internal and scrub anything key-shaped before it is written or printed.
function redact(s: string): string {
  let out = s;
  const key = process.env.OPENROUTER_API_KEY;
  if (key) out = out.split(key).join("***");
  return out.replace(/sk-[A-Za-z0-9._-]{8,}/g, "sk-***");
}

// A deny-probe leak: any non-empty body returned on a request that should have been refused.
function bodyHasData(b: unknown): boolean {
  if (b === undefined || b === null) return false;
  if (typeof b === "string") return b.trim().length > 0;
  if (Array.isArray(b)) return b.length > 0;
  if (typeof b === "object") return Object.keys(b).length > 0;
  return true;
}

// An allow-probe (authorized) response only counts toward CLEAN if it actually carries the expected
// non-empty balances data — a 2xx with an absent/empty/error-shaped body is not proof of CLEAN.
function hasBalances(b: unknown): boolean {
  if (b === null || typeof b !== "object") return false;
  const balances = (b as { balances?: unknown }).balances;
  return Array.isArray(balances) && balances.length > 0 && balances.every((x) => x !== null && typeof x === "object" && "balance" in (x as object));
}

async function probe(token: string | null): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  try {
    const r = await fetch(`http://localhost:${PORT}/admin/balances`, { headers, signal: AbortSignal.timeout(5000) });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

function mkProbe(label: string, auth: Probe["auth_context"], expected: Probe["expected"], token: string | null, res: { status: number; body: unknown }): Probe {
  return {
    label,
    auth_context: auth,
    expected,
    request: { method: "GET", url: `http://localhost:${PORT}/admin/balances`, headers: token ? { authorization: `Bearer ${token}` } : {}, body: null },
    response: { status: res.status, headers: {}, body: res.body },
  };
}

function deriveVerdict(probes: Probe[]): Verdict {
  const deny = probes.filter((p) => p.expected === "deny");
  const allow = probes.filter((p) => p.expected === "allow");
  // EXPLOITED: a request that should have been refused returned success + data.
  const leak = deny.some((p) => p.response.status >= 200 && p.response.status < 300 && bodyHasData(p.response.body));
  if (leak) return "EXPLOITED";
  // CLEAN requires positive proof on BOTH sides: every deny actually denied (401/403), AND at least
  // one authorized probe succeeded with real balances. Anything short of that is INCONCLUSIVE.
  const allDenied = deny.length > 0 && deny.every((p) => p.response.status === 401 || p.response.status === 403);
  const allowProven = allow.length > 0 && allow.every((p) => p.response.status >= 200 && p.response.status < 300 && hasBalances(p.response.body));
  return allDenied && allowProven ? "CLEAN" : "INCONCLUSIVE";
}

// Health poll bounded overall AND per-request: a single hung fetch cannot outlast the deadline.
async function waitHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const r = await fetch(`http://localhost:${PORT}/health`, {
        signal: AbortSignal.timeout(Math.max(250, Math.min(3000, remaining))),
      });
      if (r.ok) {
        const b = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (b?.ok === true) return true;
      }
    } catch {
      /* not up yet / this attempt timed out */
    }
    await sleep(400);
  }
  return false;
}

interface Row {
  scenario: string;
  run: number;
  expected: string;
  got: string;
  scope: boolean;
  seal: string;
  pass: boolean;
}

function ensureCommit(clone: string, sha: string) {
  try {
    execFileSync("git", ["-C", clone, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
  } catch {
    // Not reachable from the default clone (e.g. history rewritten) — try to fetch the exact object.
    execFileSync("git", ["-C", clone, "fetch", "--quiet", "origin", sha], { stdio: "ignore" });
  }
}

async function main() {
  const key = openrouterKey();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "falcon-bench-"));
  const clone = path.join(work, "vulnbank");
  console.log(`bench: workspace ${work}`);
  console.log("bench: cloning vulnbank…");
  execFileSync("git", ["clone", "--quiet", REPO, clone], { stdio: "ignore" });
  for (const sha of [BASE_SHA, ...SCENARIOS.map((s) => s.sha)]) ensureCommit(clone, sha);
  console.log("bench: npm install (once)…");
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent"], { cwd: clone, stdio: "ignore" });

  const ledger = new LocalLedgerStore(path.join(work, "ledger.jsonl"));
  const artifacts = new LocalArtifactStore(path.join(work, "artifacts"));
  const auditor = async (input: AuditFindingInput) => {
    const call = makeOpenRouterCall({ model: AUDITOR_MODEL, apiKey: key });
    return auditFinding(input, call, { auditorModel: AUDITOR_MODEL, writerModel: WRITER_MODEL });
  };

  const rows: Row[] = [];

  for (const sc of SCENARIOS) {
    // Pinned checkout + pinned-baseline diff, so scoping measures exactly the recorded revision.
    execFileSync("git", ["-C", clone, "checkout", "--quiet", sc.sha], { stdio: "ignore" });
    const diff = execFileSync("git", ["-C", clone, "diff", BASE_SHA, sc.sha, "--", "src/routes/admin.ts"], { encoding: "utf8" });
    const route = scopeSurface(diff).routes.find((r) => r.path === "/admin/balances");
    const scopeOk = Boolean(route) && route!.auth_present === (sc.name === "safe");

    console.log(`\nbench: booting ${sc.branch} @ ${sc.sha.slice(0, 10)} …`);
    const child = spawn("npm", ["start"], { cwd: clone, env: { ...process.env, PORT: String(PORT) }, detached: true, stdio: "ignore" });
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } };
    if (!(await waitHealth(60_000))) {
      kill();
      for (let run = 1; run <= RUNS; run++) rows.push({ scenario: sc.name, run, expected: sc.expect, got: "BOOT-FAIL", scope: scopeOk, seal: "—", pass: false });
      continue;
    }

    for (let run = 1; run <= RUNS; run++) {
      const probes = [
        mkProbe("no-token", "unauthenticated", "deny", null, await probe(null)),
        mkProbe("non-admin", "non-admin", "deny", "tenant-a-token", await probe("tenant-a-token")),
        mkProbe("admin", "authorized", "allow", "admin-token", await probe("admin-token")),
      ];
      const got = deriveVerdict(probes);

      let seal = key ? "—" : "skip(no-key)";
      if (key && (got === "EXPLOITED" || got === "CLEAN")) {
        try {
          await sealEvidence({ target_repo: "DevLab-mgc/vulnbank", pr_number: sc.pr, route: "/admin/balances", verdict: got, probes, approver: null }, ledger, artifacts, auditor);
          seal = (await verifyLedger(ledger, artifacts)).valid ? "sealed+verified" : "verify-failed";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          seal = /unavailable/i.test(msg) ? "audit-unavailable" : "audit-rejected";
        }
      }
      const pass = got === sc.expect && scopeOk; // the headline is verdict correctness
      rows.push({ scenario: sc.name, run, expected: sc.expect, got, scope: scopeOk, seal, pass });
      console.log(`  run ${run}: ${got.padEnd(12)} scope=${scopeOk ? "ok" : "X"} seal=${seal} → ${pass ? "PASS" : "FAIL"}`);
    }
    kill();
    await sleep(500);
  }

  console.log("\n=== VERDICT MATRIX ===");
  console.log("scenario   run  expected     got          scope  seal              result");
  for (const r of rows) {
    console.log(`${r.scenario.padEnd(10)} ${String(r.run).padEnd(4)} ${r.expected.padEnd(12)} ${r.got.padEnd(12)} ${(r.scope ? "ok" : "X").padEnd(6)} ${r.seal.padEnd(17)} ${r.pass ? "PASS" : "FAIL"}`);
  }

  // Measured metrics (not configured counts): a flaw is *caught* only when an EXPLOITED-expected
  // scenario passed every run; a *false alarm* is a CLEAN-expected scenario reported EXPLOITED.
  const scScored = SCENARIOS.map((sc) => {
    const rs = rows.filter((r) => r.scenario === sc.name);
    return { sc, allPass: rs.length > 0 && rs.every((r) => r.pass), reportedExploited: rs.some((r) => r.got === "EXPLOITED") };
  });
  const planted = SCENARIOS.filter((s) => s.expect === "EXPLOITED").length;
  const controls = SCENARIOS.filter((s) => s.expect === "CLEAN").length;
  const caught = scScored.filter((s) => s.sc.expect === "EXPLOITED" && s.allPass).length;
  const falseAlarms = scScored.filter((s) => s.sc.expect === "CLEAN" && s.reportedExploited).length;
  const falseNegativeRuns = rows.filter((r) => r.expected === "EXPLOITED" && r.got !== "EXPLOITED").length;
  const inconclusiveOrBootRuns = rows.filter((r) => r.got === "INCONCLUSIVE" || r.got === "BOOT-FAIL").length;
  const scopeFailureRuns = rows.filter((r) => !r.scope).length;
  const allPass = rows.every((r) => r.pass);

  const headline = `${caught}/${planted} planted flaw${planted === 1 ? "" : "s"} caught, ${falseAlarms} false alarm${falseAlarms === 1 ? "" : "s"} across ${controls} healthy control${controls === 1 ? "" : "s"}, ${RUNS} runs each — ${allPass ? "all verdicts correct." : "SOME VERDICTS WRONG."}`;
  console.log(`\n${headline}`);
  if (falseNegativeRuns || inconclusiveOrBootRuns || scopeFailureRuns) {
    console.log(`anomalies — false-negative runs: ${falseNegativeRuns} · inconclusive/boot-fail runs: ${inconclusiveOrBootRuns} · scope-failure runs: ${scopeFailureRuns}`);
  }
  if (!key) console.log("(OPENROUTER_API_KEY not set — audit-in-seal skipped; verdicts still measured from real probes)");

  // Record the result artifact so the dated headline in the README has a matching, checked-in record.
  const artifact = {
    tool: "attesta-mcp bench",
    generated_at: new Date().toISOString(),
    repo: REPO,
    pinned: { base: BASE_SHA, scenarios: SCENARIOS.map((s) => ({ name: s.name, branch: s.branch, sha: s.sha, expect: s.expect })) },
    runs_per_scenario: RUNS,
    models: { writer: WRITER_MODEL, auditor: AUDITOR_MODEL },
    audit_in_seal: Boolean(key),
    rows,
    summary: { planted, caught, controls, false_alarms: falseAlarms, false_negative_runs: falseNegativeRuns, inconclusive_or_boot_fail_runs: inconclusiveOrBootRuns, scope_failure_runs: scopeFailureRuns, all_pass: allPass },
    headline,
  };
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(path.join(RESULTS_DIR, "latest.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.log(`bench: wrote ${path.join("bench-results", "latest.json")}`);

  await fs.rm(work, { recursive: true, force: true }).catch((e) => {
    console.error(`bench: workspace cleanup failed (safe to ignore): ${redact(e instanceof Error ? e.message : String(e))}`);
  });
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  // Generic to stderr; full (redacted) diagnostics only in an internal, gitignored log.
  console.error("bench: failed with an unexpected error — details in bench-results/bench-error.log");
  try {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const detail = e instanceof Error ? e.stack ?? e.message : String(e);
    await fs.writeFile(path.join(RESULTS_DIR, "bench-error.log"), redact(detail) + "\n", "utf8");
  } catch {
    /* logging is best-effort */
  }
  process.exit(1);
});
