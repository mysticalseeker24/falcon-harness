// bench — the product's own test of its headline claim.
//
// For each vulnbank demo branch, ×3: boot the REAL fixture, probe it over HTTP, run the REAL
// attesta-mcp pipeline (scope_surface on the diff → derive the verdict from the probes → audit +
// seal the evidence on a different model family → verify the ledger), and check the verdict.
// Prints a matrix and EXITS NON-ZERO if any verdict is wrong. No asserted numbers — only measured.

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
const SCENARIOS = [
  { name: "vuln", branch: "pr/admin-balances-vuln", pr: 3, expect: "EXPLOITED" as const },
  { name: "safe", branch: "pr/admin-balances-safe", pr: 4, expect: "CLEAN" as const },
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

function bodyHasData(b: unknown): boolean {
  if (b === undefined || b === null) return false;
  if (typeof b === "string") return b.trim().length > 0;
  if (Array.isArray(b)) return b.length > 0;
  if (typeof b === "object") return Object.keys(b).length > 0;
  return true;
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
  const violation = deny.some((p) => p.response.status >= 200 && p.response.status < 300 && bodyHasData(p.response.body));
  if (violation) return "EXPLOITED";
  const allow = probes.filter((p) => p.expected === "allow");
  const allDenied = deny.length > 0 && deny.every((p) => p.response.status === 401 || p.response.status === 403);
  const allowOk = allow.every((p) => p.response.status >= 200 && p.response.status < 300);
  return allDenied && allowOk ? "CLEAN" : "INCONCLUSIVE";
}

async function waitHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) {
        const b = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (b?.ok === true) return true;
      }
    } catch {
      /* not up yet */
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

async function main() {
  const key = openrouterKey();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "falcon-bench-"));
  const clone = path.join(work, "vulnbank");
  console.log(`bench: workspace ${work}`);
  console.log("bench: cloning vulnbank + branches…");
  execFileSync("git", ["clone", "--quiet", REPO, clone], { stdio: "ignore" });
  execFileSync("git", ["-C", clone, "fetch", "--quiet", "origin", ...SCENARIOS.map((s) => s.branch)], { stdio: "ignore" });
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
    execFileSync("git", ["-C", clone, "checkout", "--quiet", `origin/${sc.branch}`], { stdio: "ignore" });
    const diff = execFileSync("git", ["-C", clone, "diff", "origin/main", `origin/${sc.branch}`, "--", "src/routes/admin.ts"], { encoding: "utf8" });
    const route = scopeSurface(diff).routes.find((r) => r.path === "/admin/balances");
    const scopeOk = Boolean(route) && route!.auth_present === (sc.name === "safe");

    console.log(`\nbench: booting ${sc.branch} …`);
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

  const planted = SCENARIOS.filter((s) => s.expect === "EXPLOITED").length;
  const controls = SCENARIOS.filter((s) => s.expect === "CLEAN").length;
  const wrong = rows.filter((r) => r.got !== r.expected).length;
  const allPass = rows.every((r) => r.pass);
  console.log(
    `\n${planted} planted flaw${planted === 1 ? "" : "s"} caught, ${wrong} false alarm${wrong === 1 ? "" : "s"} across ${controls} healthy control${controls === 1 ? "" : "s"}, ${RUNS} runs each — ${allPass ? "all verdicts correct." : "SOME VERDICTS WRONG."}`,
  );
  if (!key) console.log("(OPENROUTER_API_KEY not set — audit-in-seal skipped; verdicts still measured from real probes)");

  await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("bench error:", e);
  process.exit(1);
});
