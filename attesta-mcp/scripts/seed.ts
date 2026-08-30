// Generate the committed seed ledger the deployed backend serves on first boot.
//
//   npm run seed        # writes attesta-mcp/seed/{ledger.jsonl,artifacts/}
//
// Provenance: the evidence is CAPTURED, not hand-written. For each pinned vulnbank revision this
// boots the REAL fixture, probes /admin/balances over HTTP, and seals the captured request/response
// pairs through the SAME audited pipeline the agent uses (audit on a different model family). It
// generates into a temp dir and verifies fully, then atomically replaces seed/ — restoring the old
// seed if the swap fails — so a failed run never destroys the existing seed. Requires a POSIX shell
// (process-group kill), git, npm, and OPENROUTER_API_KEY. Only ever targets the approved fixture.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealEvidence, verifyLedger } from "../src/lib/ledger.js";
import { auditFinding, type AuditFindingInput, type Probe } from "../src/lib/auditor.js";
import { makeOpenRouterCall } from "../src/lib/openrouter.js";
import { LocalArtifactStore, LocalLedgerStore } from "../src/storage/local.js";

const REPO = "https://github.com/DevLab-mgc/vulnbank.git";
const PORT = 3998;
const AUDITOR_MODEL = process.env.AUDITOR_MODEL ?? "z-ai/glm-5.3-flash";
const WRITER_MODEL = process.env.WRITER_MODEL ?? "deepseek/deepseek-v4-pro-0813";
const SEED_DIR = path.resolve(process.cwd(), "seed");

// Pinned immutable revisions (same as bench). Each yields one captured, audited seed entry.
const SCENARIOS = [
  { name: "EXPLOITED", branch: "pr/admin-balances-vuln", sha: "68cd31e2d88e97e363798119fc61cd7eab446558", pr: 3, verdict: "EXPLOITED" as const },
  { name: "CLEAN", branch: "pr/admin-balances-safe", sha: "a0cd8ca150336322fa518b10c76329d1ef06f859", pr: 4, verdict: "CLEAN" as const },
];

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

async function captureProbe(label: string, auth: Probe["auth_context"], expected: Probe["expected"], token: string | null): Promise<Probe> {
  const url = `http://localhost:${PORT}/admin/balances`;
  const reqHeaders: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  let status = 0;
  let body: unknown = null;
  try {
    const r = await fetch(url, { headers: reqHeaders, signal: AbortSignal.timeout(5000) });
    status = r.status;
    body = await r.json().catch(() => null);
  } catch {
    /* leave status 0 */
  }
  return {
    label,
    auth_context: auth,
    expected,
    // The Authorization value is redacted deep in seal_evidence before hashing/storing.
    request: { method: "GET", url, headers: reqHeaders, body: null },
    response: { status, headers: { "content-type": "application/json; charset=utf-8" }, body },
  };
}

async function waitHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const r = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(Math.max(250, Math.min(3000, remaining))) });
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

async function main() {
  const key = openrouterKey();
  if (!key) {
    console.error("seed: OPENROUTER_API_KEY not set (needed for the real audit) — aborting");
    process.exit(1);
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), "falcon-seed-"));
  const clone = path.join(work, "vulnbank");
  // Build the seed as a SIBLING of seed/ (same filesystem) so the final rename is atomic — a temp dir
  // under the OS tmpdir can be on another device and fail rename with EXDEV.
  const tmpSeed = `${SEED_DIR}.tmp`;
  await fs.rm(tmpSeed, { recursive: true, force: true });
  console.log(`seed: workspace ${work}`);
  console.log("seed: cloning vulnbank + installing (once)…");
  execFileSync("git", ["clone", "--quiet", REPO, clone], { stdio: "ignore" });
  for (const sc of SCENARIOS) {
    try {
      execFileSync("git", ["-C", clone, "cat-file", "-e", `${sc.sha}^{commit}`], { stdio: "ignore" });
    } catch {
      execFileSync("git", ["-C", clone, "fetch", "--quiet", "origin", sc.sha], { stdio: "ignore" });
    }
  }
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent"], { cwd: clone, stdio: "ignore" });

  const ledger = new LocalLedgerStore(path.join(tmpSeed, "ledger.jsonl"));
  const artifacts = new LocalArtifactStore(path.join(tmpSeed, "artifacts"));
  const auditor = async (input: AuditFindingInput) => {
    const call = makeOpenRouterCall({ model: AUDITOR_MODEL, apiKey: key });
    return auditFinding(input, call, { auditorModel: AUDITOR_MODEL, writerModel: WRITER_MODEL });
  };

  for (const sc of SCENARIOS) {
    execFileSync("git", ["-C", clone, "checkout", "--quiet", sc.sha], { stdio: "ignore" });
    console.log(`seed: booting ${sc.branch} @ ${sc.sha.slice(0, 10)} …`);
    const child = spawn("npm", ["start"], { cwd: clone, env: { ...process.env, PORT: String(PORT) }, detached: true, stdio: "ignore" });
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } };
    try {
      if (!(await waitHealth(60_000))) throw new Error(`${sc.branch} did not become healthy`);
      const probes = [
        await captureProbe("no-token", "unauthenticated", "deny", null),
        await captureProbe("non-admin", "non-admin", "deny", "tenant-a-token"),
        await captureProbe("admin", "authorized", "allow", "admin-token"),
      ];
      console.log(`seed: sealing ${sc.name} (captured: ${probes.map((p) => p.response.status).join("/")})…`);
      const { entry_hash } = await sealEvidence(
        { target_repo: "DevLab-mgc/vulnbank", pr_number: sc.pr, route: "/admin/balances", verdict: sc.verdict, probes, approver: null },
        ledger, artifacts, auditor,
      );
      console.log(`  entry ${entry_hash}`);
    } finally {
      kill();
      await sleep(500);
    }
  }

  const v = await verifyLedger(ledger, artifacts);
  console.log(`seed: verify → valid=${v.valid} length=${v.length}`);
  if (!v.valid || v.length !== SCENARIOS.length) {
    throw new Error(`refusing to publish an invalid seed (valid=${v.valid}, length=${v.length})`);
  }

  // Atomic swap: only now replace the existing seed; restore it if the move fails.
  const backup = `${SEED_DIR}.bak`;
  await fs.rm(backup, { recursive: true, force: true });
  if (existsSync(SEED_DIR)) await fs.rename(SEED_DIR, backup);
  try {
    await fs.rename(tmpSeed, SEED_DIR);
  } catch (err) {
    if (existsSync(backup)) await fs.rename(backup, SEED_DIR); // restore the old seed
    throw err;
  }
  await fs.rm(backup, { recursive: true, force: true });
  await fs.rm(work, { recursive: true, force: true }).catch((e) => console.error("seed: cleanup failed (safe to ignore):", e instanceof Error ? e.message : e));
  console.log(`seed: wrote ${path.relative(process.cwd(), SEED_DIR)}/ (ledger.jsonl + artifacts)`);
}

main().catch((e) => {
  console.error("seed: failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
