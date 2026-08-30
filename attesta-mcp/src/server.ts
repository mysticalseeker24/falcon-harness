import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { Request } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { scopeSurface } from "./lib/scopeSurface.js";
import { sealEvidence, verifyLedger, type Auditor } from "./lib/ledger.js";
import { auditFinding } from "./lib/auditor.js";
import { makeOpenRouterCall } from "./lib/openrouter.js";
import { canonicalJson } from "./lib/canonicalJson.js";
import { getStorePaths, getStores } from "./storage/factory.js";

// The independent auditor runs on a DIFFERENT model family than the main agent (the writer). Default
// auditor: cheap z-ai/glm-5.3-flash; writer default: DeepSeek. Independence is enforced (not assumed)
// by comparing model families at audit time.
const AUDITOR_MODEL = process.env.AUDITOR_MODEL ?? "z-ai/glm-5.3-flash";
const WRITER_MODEL = process.env.WRITER_MODEL ?? "deepseek/deepseek-v4-pro-0813";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

// One shared storage backend for the process (local FS by default; see storage/factory.ts).
const stores = getStores();

// The auditor injected into seal_evidence. Fails closed if the key is missing.
const auditor: Auditor = async (input) => {
  if (!OPENROUTER_API_KEY) {
    return { auditor_ok: false, reason: "auditor model not configured (OPENROUTER_API_KEY missing)", checks: [], model: AUDITOR_MODEL };
  }
  const modelCall = makeOpenRouterCall({ model: AUDITOR_MODEL, apiKey: OPENROUTER_API_KEY, baseUrl: OPENROUTER_BASE_URL });
  return auditFinding(input, modelCall, { auditorModel: AUDITOR_MODEL, writerModel: WRITER_MODEL });
};

// One captured probe (a complete HTTP exchange + who called it + what correct access control should do).
const httpRequest = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.unknown()),
  body: z.unknown().nullable(),
});
const httpResponse = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.unknown()),
  body: z.unknown().nullable(),
});
const probeSchema = z.object({
  label: z.string(),
  auth_context: z.enum(["unauthenticated", "wrong-tenant", "non-admin", "authorized"]),
  expected: z.enum(["deny", "allow"]),
  request: httpRequest,
  response: httpResponse,
});

// Honor a platform-provided PORT (Render sets it) as well as our explicit var. Bind all interfaces
// when a platform PORT is present (the host provides the network boundary + TLS), loopback otherwise.
const PORT = Number(process.env.ATTESTA_MCP_PORT ?? process.env.PORT ?? 8130);
const HOST = process.env.ATTESTA_MCP_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

// The MCP endpoint is the only mutation surface (seal_evidence spends the OpenRouter account and
// writes the ledger; APPROVAL trusts its `approver`). When ATTESTA_MCP_TOKEN is set (required for any
// public deploy), every /mcp call must present it as a bearer token — reads stay public via the
// GET /ledger and GET /verify endpoints, which need no secret. Unset ⇒ open, for loopback dev only.
const MCP_TOKEN = process.env.ATTESTA_MCP_TOKEN ?? "";
function mcpAuthorized(req: Request): boolean {
  if (!MCP_TOKEN) return true;
  const presented = req.header("authorization") ?? "";
  const expected = `Bearer ${MCP_TOKEN}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Await both closes and log any failure, so cleanup can never become an unhandled rejection.
async function closeQuietly(transport: StreamableHTTPServerTransport, server: McpServer): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve(transport.close()),
    Promise.resolve(server.close()),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("MCP cleanup failed:", r.reason);
  }
}

// Stateless Streamable-HTTP MCP server (the transport confirmed working in spike 01).
function buildServer(): McpServer {
  const server = new McpServer({ name: "attesta-mcp", version: "0.1.0" });

  server.tool(
    "scope_surface",
    "Given a unified PR diff, return the new HTTP routes it introduces and whether each has an auth middleware attached. Regex over added diff lines; the diff is treated as untrusted and never executed.",
    { diff: z.string().describe("unified diff text of the pull request") },
    async ({ diff }) => {
      const result = scopeSurface(diff);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "seal_evidence",
    "Append a hash-chained entry to the tamper-evident ledger. For EXPLOITED/CLEAN, pass the full set of `probes` (each a complete HTTP exchange + auth_context + expected deny/allow). The server independently AUDITS the probes on a different model family and refuses to seal unless the audit passes — there is no caller-supplied auditor_ok. Credentials are redacted at any depth before hashing/storing. For APPROVAL, pass approver + approves_entry_hash (the finding a human approved); no probes. Returns the new entry_hash (or an error if the audit did not pass — treat that as INCONCLUSIVE).",
    {
      target_repo: z.string(),
      pr_number: z.number().int().nullish(),
      route: z.string().nullish(),
      verdict: z.enum(["EXPLOITED", "CLEAN", "APPROVAL"]),
      probes: z.array(probeSchema).optional(),
      // For APPROVAL only. NOTE: an APPROVAL entry is sealed by the authenticated approval handler
      // (the dashboard), which supplies `approver` from its trusted session — not the main agent.
      approver: z.string().nullish(),
      approves_entry_hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/, "must be a 64-char lowercase hex hash")
        .nullish(),
    },
    async (input) => {
      const result = await sealEvidence(
        {
          target_repo: input.target_repo,
          pr_number: input.pr_number ?? null,
          route: input.route ?? null,
          verdict: input.verdict,
          probes: input.probes,
          approver: input.approver ?? null,
          approves_entry_hash: input.approves_entry_hash ?? null,
        },
        stores.ledger,
        stores.artifacts,
        auditor,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "verify_ledger",
    "Recompute the ledger hash chain from genesis and re-read + re-hash each stored artifact's bytes. Returns { valid, length, broken_at }. broken_at is the id of the first tampered entry, or null.",
    {},
    async () => {
      const result = await verifyLedger(stores.ledger, stores.artifacts);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.post("/mcp", async (req, res) => {
  if (!mcpAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void closeQuietly(transport, server);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Read-only ledger listing for the dashboard, which reads it server-side (no filesystem sharing in a
// split deploy). NOT a mutation surface: seals happen only through the audited seal_evidence tool.
// Each entry is emitted as its FULL canonical representation — the exact bytes canonicalJson produced
// when the entry was hashed and stored (CONVENTIONS §5) — so there is a single serialization contract
// for a ledger entry and no divergent projection. A ledger entry carries no secrets (credentials are
// redacted into the artifact at seal time), so the full entry is safe to expose. Corrupt rows surface
// as a typed marker, not a fabricated entry.
app.get("/ledger", async (_req, res) => {
  try {
    const rows = await stores.ledger.read();
    const entries = rows.map((r, i) => (r.ok ? r.entry : { corrupt: true, index: i }));
    res.type("application/json").send(canonicalJson({ entries }));
  } catch (err) {
    console.error("/ledger read failed:", err);
    res.status(500).json({ error: "ledger read failed" });
  }
});

// Public, read-only verification: recompute the chain + re-hash artifact bytes (the same authoritative
// check as the verify_ledger tool). Lets the dashboard verify live without holding the write token.
app.get("/verify", async (_req, res) => {
  try {
    const result = await verifyLedger(stores.ledger, stores.artifacts);
    res.json(result);
  } catch (err) {
    console.error("/verify failed:", err);
    res.status(500).json({ error: "verify failed" });
  }
});

// On a fresh deploy the persistent disk is empty; copy the bundled seed in so the live console shows
// real, verifiable entries on first visit. Disable with ATTESTA_SEED_ON_BOOT=0.
//
// Publishing is transactional AND recoverable, because an entry whose artifact is missing verifies as
// broken:
//   • Fresh disk — copy ALL artifacts FIRST, then commit the ledger LAST via an atomic rename. The
//     ledger file is the "initialized" marker, so it can never appear before the artifacts it
//     references; a crash mid-copy leaves no ledger and the next boot retries cleanly.
//   • Existing ledger — recover a previously-partial seed by re-copying artifacts, but ONLY when the
//     ledger is still byte-identical to the seed (nothing real has been appended). A diverged ledger
//     (real data) is never touched.
async function seedIfEmpty(): Promise<void> {
  if (process.env.ATTESTA_SEED_ON_BOOT === "0") return;
  const { ledgerPath, artifactDir } = getStorePaths();
  const seedDir = process.env.ATTESTA_SEED_DIR ?? path.resolve(process.cwd(), "seed");
  const seedLedger = path.join(seedDir, "ledger.jsonl");
  if (!existsSync(seedLedger)) return;
  const seedArtifacts = path.join(seedDir, "artifacts");

  const copyArtifacts = async (): Promise<void> => {
    if (!existsSync(seedArtifacts)) return;
    await fs.mkdir(artifactDir, { recursive: true });
    for (const f of await fs.readdir(seedArtifacts)) {
      // Content-addressed + idempotent: re-copying an already-present artifact is a harmless no-op.
      await fs.copyFile(path.join(seedArtifacts, f), path.join(artifactDir, f));
    }
  };

  if (existsSync(ledgerPath)) {
    try {
      const [have, seed] = await Promise.all([fs.readFile(ledgerPath, "utf8"), fs.readFile(seedLedger, "utf8")]);
      if (have === seed) await copyArtifacts(); // restore artifacts a prior partial seed may have missed
    } catch (err) {
      console.error("attesta-mcp: seed recovery check skipped:", err);
    }
    return;
  }

  await copyArtifacts(); // artifacts first…
  await fs.mkdir(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  const tmpLedger = `${ledgerPath}.seed.tmp`;
  await fs.copyFile(seedLedger, tmpLedger);
  await fs.rename(tmpLedger, ledgerPath); // …then commit the ledger marker atomically, last
  console.log(`attesta-mcp: seeded ledger from ${seedDir}`);
}

seedIfEmpty()
  .catch((err) => console.error("attesta-mcp: seed skipped:", err))
  .finally(() => {
    app.listen(PORT, HOST, () => {
      console.log(`attesta-mcp listening on http://${HOST}:${PORT}/mcp`);
    });
  });
