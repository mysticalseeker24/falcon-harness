// Generate the committed seed ledger the deployed backend serves on first boot. It seals a real
// EXPLOITED and a real CLEAN finding through the SAME audited pipeline the agent uses — the audit
// runs on a different model family, and the result verifies — so the live console shows genuine,
// re-verifiable entries, not hand-written fixtures.
//
//   npm run seed        # writes attesta-mcp/seed/{ledger.jsonl,artifacts/}
//
// The evidence mirrors the real captured vulnbank exchanges (see dashboard/lib/demo.ts).

import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { sealEvidence, verifyLedger } from "../src/lib/ledger.js";
import { auditFinding, type AuditFindingInput, type Probe } from "../src/lib/auditor.js";
import { makeOpenRouterCall } from "../src/lib/openrouter.js";
import { LocalArtifactStore, LocalLedgerStore } from "../src/storage/local.js";

const AUDITOR_MODEL = process.env.AUDITOR_MODEL ?? "z-ai/glm-5.3-flash";
const WRITER_MODEL = process.env.WRITER_MODEL ?? "deepseek/deepseek-v4-pro-0813";
const SEED_DIR = path.resolve(process.cwd(), "seed");
const URL = "http://localhost:3000/admin/balances";

function openrouterKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.resolve(process.cwd(), "../.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return "";
}

const balances = [
  { id: "acc-a-001", tenantId: "tenant-a", owner: "Alice", balance: 42000, currency: "USD" },
  { id: "acc-a-002", tenantId: "tenant-a", owner: "Aaron", balance: 15750, currency: "USD" },
  { id: "acc-b-001", tenantId: "tenant-b", owner: "Bob", balance: 88300, currency: "USD" },
  { id: "acc-b-002", tenantId: "tenant-b", owner: "Bianca", balance: 2650, currency: "USD" },
];

function mkProbe(label: string, auth: Probe["auth_context"], expected: Probe["expected"], token: string | null, status: number, body: unknown): Probe {
  return {
    label,
    auth_context: auth,
    expected,
    request: { method: "GET", url: URL, headers: token ? { authorization: `Bearer ${token}` } : {}, body: null },
    response: { status, headers: { "content-type": "application/json; charset=utf-8" }, body },
  };
}

const exploitedProbes: Probe[] = [
  mkProbe("no-token", "unauthenticated", "deny", null, 200, { balances }),
  mkProbe("non-admin", "non-admin", "deny", "tenant-a-token", 200, { balances }),
  mkProbe("admin", "authorized", "allow", "admin-token", 200, { balances }),
];
const cleanProbes: Probe[] = [
  mkProbe("no-token", "unauthenticated", "deny", null, 401, { error: "missing Authorization header" }),
  mkProbe("non-admin", "non-admin", "deny", "tenant-a-token", 403, { error: "admin role required" }),
  mkProbe("admin", "authorized", "allow", "admin-token", 200, { balances }),
];

async function main() {
  const key = openrouterKey();
  if (!key) {
    console.error("seed: OPENROUTER_API_KEY not set (needed for the real audit) — aborting");
    process.exit(1);
  }

  // Regenerate cleanly so the chain is deterministic from genesis.
  await fs.rm(SEED_DIR, { recursive: true, force: true });
  const ledger = new LocalLedgerStore(path.join(SEED_DIR, "ledger.jsonl"));
  const artifacts = new LocalArtifactStore(path.join(SEED_DIR, "artifacts"));
  const auditor = async (input: AuditFindingInput) => {
    const call = makeOpenRouterCall({ model: AUDITOR_MODEL, apiKey: key });
    return auditFinding(input, call, { auditorModel: AUDITOR_MODEL, writerModel: WRITER_MODEL });
  };

  console.log("seed: sealing EXPLOITED (vulnbank PR #3)…");
  const a = await sealEvidence(
    { target_repo: "DevLab-mgc/vulnbank", pr_number: 3, route: "/admin/balances", verdict: "EXPLOITED", probes: exploitedProbes, approver: null },
    ledger, artifacts, auditor,
  );
  console.log(`  entry ${a.entry_hash}`);

  console.log("seed: sealing CLEAN (vulnbank PR #4)…");
  const b = await sealEvidence(
    { target_repo: "DevLab-mgc/vulnbank", pr_number: 4, route: "/admin/balances", verdict: "CLEAN", probes: cleanProbes, approver: null },
    ledger, artifacts, auditor,
  );
  console.log(`  entry ${b.entry_hash}`);

  const v = await verifyLedger(ledger, artifacts);
  console.log(`seed: verify → valid=${v.valid} length=${v.length}`);
  if (!v.valid) {
    console.error("seed: refusing to write an invalid seed");
    process.exit(1);
  }
  console.log(`seed: wrote ${path.relative(process.cwd(), SEED_DIR)}/ (ledger.jsonl + artifacts)`);
}

main().catch((e) => {
  console.error("seed: failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
