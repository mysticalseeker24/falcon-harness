import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { scopeSurface } from "./lib/scopeSurface.js";
import { sealEvidence, verifyLedger } from "./lib/ledger.js";
import { auditFinding } from "./lib/auditor.js";
import { makeOpenRouterCall } from "./lib/openrouter.js";
import { getStores } from "./storage/factory.js";

// The independent auditor runs on a DIFFERENT model family than the main agent (default: cheap
// z-ai/glm-5.3-flash while the main agent is DeepSeek). It must not share a family with the writer.
const AUDITOR_MODEL = process.env.AUDITOR_MODEL ?? "z-ai/glm-5.3-flash";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

// One shared storage backend for the process (local FS by default; see storage/factory.ts).
const stores = getStores();

// A captured HTTP exchange. Structured so seal_evidence can verify a verdict against real evidence.
const evidenceRequest = z
  .object({
    method: z.string(),
    path: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
    body: z.unknown().optional(),
  })
  .refine((r) => Boolean(r.path ?? r.url), { message: "request needs a path or url" });
const evidenceResponse = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
});

const PORT = process.env.ATTESTA_MCP_PORT ? Number(process.env.ATTESTA_MCP_PORT) : 8130;
// Bind to loopback by default (unauthenticated local dev server). Override only for a deployment
// that also adds authentication + network controls.
const HOST = process.env.ATTESTA_MCP_HOST ?? "127.0.0.1";

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
    "Append a hash-chained entry to the tamper-evident ledger. For EXPLOITED/CLEAN, pass the captured request+response (stored content-addressed, credentials redacted at any depth; EXPLOITED is rejected unless the response is 2xx with a non-empty body). For APPROVAL, pass approver + approves_entry_hash (the entry_hash of the finding a human approved); no request/response. Returns the new entry_hash.",
    {
      target_repo: z.string(),
      pr_number: z.number().int().nullish(),
      route: z.string().nullish(),
      verdict: z.enum(["EXPLOITED", "CLEAN", "APPROVAL"]),
      request: evidenceRequest.optional(),
      response: evidenceResponse.optional(),
      auditor_ok: z.boolean().nullish(),
      // For APPROVAL only. NOTE: an APPROVAL entry is meant to be sealed by the authenticated
      // approval handler (the dashboard), which supplies `approver` from its trusted session — not
      // by the main agent from model-supplied arguments. See .agent/GATE.md.
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
          request: input.request,
          response: input.response,
          auditor_ok: input.auditor_ok ?? null,
          approver: input.approver ?? null,
          approves_entry_hash: input.approves_entry_hash ?? null,
        },
        stores.ledger,
        stores.artifacts,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "audit_finding",
    "Independently audit an EXPLOITED/CLEAN finding on a DIFFERENT model family than the main agent (the writer is never its own verifier). Runs objective consistency checks, then a single cheap different-family model confirms the captured evidence supports the verdict. Returns { auditor_ok, reason, checks, model }. The main agent must not seal or post until auditor_ok is true.",
    {
      verdict: z.enum(["EXPLOITED", "CLEAN"]),
      route: z.string().nullish(),
      request: z.object({
        method: z.string(),
        url: z.string().optional(),
        path: z.string().optional(),
        headers: z.record(z.string(), z.unknown()).optional(),
        body: z.unknown().optional(),
      }),
      response: z.object({
        status: z.number().int(),
        headers: z.record(z.string(), z.unknown()).optional(),
        body: z.unknown().optional(),
      }),
    },
    async (input) => {
      if (!OPENROUTER_API_KEY) {
        // Fail closed: without the independent model we cannot confirm, so we never approve.
        const result = { auditor_ok: false, reason: "auditor model not configured (OPENROUTER_API_KEY missing)", checks: [], model: AUDITOR_MODEL };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      const modelCall = makeOpenRouterCall({ model: AUDITOR_MODEL, apiKey: OPENROUTER_API_KEY, baseUrl: OPENROUTER_BASE_URL });
      const result = await auditFinding(
        { verdict: input.verdict, route: input.route ?? null, request: input.request, response: input.response },
        modelCall,
        AUDITOR_MODEL,
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

app.listen(PORT, HOST, () => {
  console.log(`attesta-mcp listening on http://${HOST}:${PORT}/mcp`);
});
