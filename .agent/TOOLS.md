# TOOLS.md — Verified Tool Surfaces & Configuration

Exact, researched detail for every external tool. This file exists to prevent the small-error cascade: wrong model slug, wrong TrueForge product, wrong MCP registration path. Everything here was verified against current docs (late Aug 2026). Where a fact might have drifted, it says "verify on the page" — do that rather than assume.

---

## 1. TrueForge — WHICH product

There are two TrueForge-branded things. Do not mix them up.

- **This hackathon uses the open-source self-hosted harness**: `npx @truefoundry/trueforge`, docs at **trueforge.dev**, repo `github.com/truefoundry/trueforge`, MIT licensed, Node. Config is via the UI (Settings → Connectors / Skills) and shipped **YAML catalogs** you customize. MCP servers are added under **Settings → Connectors → Add MCP Server**. Skills are git-backed SKILL.md added under **Settings → Skills → Import from GitHub**.
- **NOT** the SaaS "Agent Harness" on truefoundry.com/docs (Playground, MCP Gateway, Skills Registry, "SaaS only"). That is the managed product. If a doc mentions MCP Gateway / integration_fqn / control-plane URLs, it is the wrong product for us.

### Modes
- **Local mode**: single process, SQLite, `npx @truefoundry/trueforge`, opens `http://localhost:8790`. Node **22.14+** required. Explicitly **not internet-facing** — localhost only. **Use this for all local dev/iteration.**
- **Hosted mode**: shared deployment, **Postgres + Redis**, Docker Compose or Helm, OIDC auth. **Use this for the deployed demo on Render.**
- Data location override in local mode: `SQLITE_PATH=~/trueforge/db.sqlite`.
- `PUBLIC_BASE_URL`: the origin handed to MCP servers for OAuth callbacks; defaults to `http://localhost:<port>`. Set it when reachable at a different address (i.e. on Render).

### What TrueForge gives us (all config, not code) — each a Double-O scoring line
- Any OpenAI-compatible model provider; switch model per task without rebuilding the agent.
- Remote MCP servers with header auth or OAuth, incl. in-chat authorization.
- Skills: git-backed SKILL.md loaded on demand into the sandbox.
- Sandbox-as-a-tool: isolated Daytona env, provisioned only when code execution is needed. Secrets stay in the harness.
- Human checkpoints: **tool approval**, ask-user-questions, Generative UI in chat.
- Subagents: parallel isolated context, returns only final result (prevents context bloat).
- SDKs: `@truefoundry/trueforge-sdk` (TypeScript HTTP client) and `@truefoundry/trueforge-ui` (embeddable themeable React chat component).

### Setup order (do this before PR 4)
1. `npx @truefoundry/trueforge` locally, open `:8790`.
2. Settings → Connectors: add **GitHub MCP** (the harness catalog has common servers; if GitHub is not in the catalog, add it by URL). Then add **attesta-mcp** by URL once it exists (PR 3).
3. Settings → Skills: Import from GitHub → the `SKILL.md` in our repo (PR 4).
4. Configure the three models (see §3). Set the main agent's model, and configure the auditor subagent on a different family.
5. Mark the GitHub **merge** tool as requiring approval (human checkpoint).

---

## 2. attesta-mcp — the MCP server we build

### Framework choice
Match whatever the TrueForge "bring your own MCP" / custom-server example uses. Options that work: **Python + FastMCP**, or **Node/TypeScript MCP SDK**. Given the rest of our stack is TS and TrueForge is Node, **prefer the TypeScript MCP SDK** unless the example strongly favors FastMCP. Either registers the same way (by URL, or stdio if co-located). Confirm the transport (SSE/HTTP vs stdio) the example uses and match it.

### Registration into TrueForge
Settings → Connectors → **Add MCP Server** → give it the server URL. For the deployed demo, that URL is the Render service hosting attesta-mcp. Auth: none for the hackathon (or a simple header token stored in the harness). **Confirm one trivial round-trip tool call in the first-90-minute spike (§10 of PROJECT_SPEC) before building the real tools.**

### The three tools

```
scope_surface(diff: string) -> {
  routes: [
    { method: string, path: string, handler: string,
      auth_present: boolean, source_line: number }
  ]
}
```
Regex over added (`+`) diff lines for `app.(get|post|put|delete|patch)(<path>, <handlers...>)`. `auth_present` = true if a known auth-middleware identifier (`authMiddleware`, `requireAuth`, `requireAdmin`, etc.) appears among the handlers. No tree-sitter. Bound input size. Never execute diff content.

```
seal_evidence(finding: object) -> { entry_hash: string }
```
Appends a hash-chained entry to the Postgres `ledger` table; stores the request/response artifact content-addressed in R2. See `CONVENTIONS.md` §5 for the exact hashing contract. Redact `Authorization` before storing.

```
verify_ledger() -> { valid: boolean, length: number, broken_at: string | null }
```
Recompute the chain from genesis AND re-download + re-hash the artifact bytes from R2. Trusting the DB row is not verification.

### `ledger` table (Postgres)
```
id            text primary key      -- uuid
ts            timestamptz not null
target_repo   text not null
pr_number     integer
route         text
verdict       text not null         -- 'EXPLOITED' | 'CLEAN' | 'APPROVAL'
request       jsonb                  -- redacted
response      jsonb
artifact_key  text                   -- R2 content-addressed key
auditor_ok    boolean
approver      text                   -- for approval entries
prev_hash     char(64) not null
entry_hash    char(64) not null
```

---

## 3. Models — via OpenRouter (all verified on OpenRouter, late Aug 2026)

One OpenRouter key. Base URL `https://openrouter.ai/api/v1` (OpenAI-compatible). Configure all three in TrueForge's model catalog by slug.

Slugs below are the ones actually configured in TrueForge and each verified reachable with a live
1-token call (HTTP 200) against our key on 2026-08-29. The `:exacto` suffix is OpenRouter's Exacto
routing (gotcha 2) applied at request time — it is a routing variant, not a separate catalog entry,
so it does not appear in `/models`; the call returns the base model with Exacto routing.

| Role | Model | Slug | Family | Notes |
|---|---|---|---|---|
| **Main agent** (planner/prober/writer) | DeepSeek V4 Pro 0813 | `deepseek/deepseek-v4-pro-0813:exacto` | DeepSeek | Built for long-horizon agent workflows + multi-step automation; 1M ctx; strong function calling. Exacto suffix for tool-calling accuracy. Base slug verified valid on OpenRouter. |
| **Auditor subagent** (independent verifier) | GPT-5.6 Sol Pro | `openai/gpt-5.6-sol-pro` | OpenAI | Flagship reasoning; makes the independence claim credible. Few calls, cost negligible. No `:exacto` — the auditor does not call tools, so routing tuning is unnecessary. |
| **Dev iteration + fast/cheap steps** | GLM-5.3-Flash | `z-ai/glm-5.3-flash:exacto` | Z.ai | ~$0.075–0.15 in / $0.25–0.50 out; fast. Current **main agent while spiking** (cheap); switch main to DeepSeek for demo + bench. |

### Independence guarantee
Main agent family ≠ auditor family, always. DeepSeek (main) vs OpenAI (auditor) is clean. If you ever swap the main agent to GLM for a run, the auditor must be DeepSeek or OpenAI, never GLM.

### OpenRouter gotchas (these cause the intermittent failures)
1. **Pin providers.** GLM is served by many providers with a 2x price spread and context ceilings from 262K to 1.31M; default routing can silently hand you a 262K-context provider and a long request then fails. Pin Z.AI or GMICloud for GLM. Same discipline for the others.
2. **Use OpenRouter "Exacto" routing for the main agent** (optimizes for tool-calling accuracy). The main loop must reliably call scope_surface, sandbox tools, seal_evidence, and the GitHub merge; a dropped tool call is the likeliest cause of a flaky demo. **Done:** applied via the `:exacto` slug suffix on both main-agent-capable models (DeepSeek + GLM); the auditor stays plain.
3. **Verify the DeepSeek slug** before wiring (one-minute check on its model page). **Done (2026-08-29):** `deepseek/deepseek-v4-pro-0813` and `z-ai/glm-5.3-flash` both return HTTP 200 on a live call; `:exacto` variants of each also 200.

---

## 4. Daytona — the sandbox

- TrueForge's sandbox provider is **Daytona** (Firecracker-style isolated envs, provisioned on demand). You are a Tier 1 account holder.
- Configure the Daytona API key in TrueForge (Settings → sandbox/connectors). Secrets stay in the harness; the agent never sees the key.
- The sandbox is where the agent **boots `vulnbank` and runs the generated probe**. Boot: `npm install && npm start` on `:3000`; probe hits `localhost:3000` inside the same sandbox.
- **Spike this in hour 1** (unknown #2). If booting the app + probing localhost in one sandbox is fiddly, fall back: deploy `vulnbank` to a Render URL and have the sandbox probe that URL. Both count as sandboxed execution.

---

## 5. GitHub MCP — read PR, comment, merge

- Added as an MCP server in TrueForge (catalog or by URL). Auth: a GitHub token scoped to the `DevLab-mgc/vulnbank` repo (and the falcon-harness repo if needed), stored in the harness, never in code.
- Tools used: read PR diff, post PR comment, **merge PR**.
- **Mark merge as requiring human approval** (TrueForge tool-approval checkpoint). This is the gate. The comment tool does not require approval; only merge does.

---

## 6. The approval gate — native vs fallback

- **Native path — CONFIRMED (2026-08-29, spike 03), use this.** An external client reads and actions approvals over the HTTP API (`@truefoundry/trueforge-sdk` wraps the same endpoints). Exact flow:
  - Mark tools approval-gated per MCP server with `require_approval_for_tools` (`@all` / `@write` / `@destructive` / literal names; default `["@write","@destructive"]`). The GitHub **merge** tool is our gate.
  - When the agent calls a gated tool, the turn ends with a `tool.approval_required` event carrying `thread_id` + `tool_calls[].id` (also in the turn's `pending_actions` and `/api/v1/sessions/{id}/turns/{turn_id}/events`).
  - Resume by POSTing a new turn whose input is `{ type:"user.tool_approval", thread_id, tool_call_id, approval:{ status:"allow"|"deny" } }` to `/api/v1/sessions/{id}/turns`.
  - The dashboard renders the blocking card from the `tool.approval_required` state and calls the resume for Approve/Reject. Reference driver: `spikes/03-approval-sdk/approval-roundtrip.mjs`.
- **Fallback (NOT needed):** an MCP tool `request_human_approval(summary) -> {approved}` blocking on a DB flag. Kept only as a note; the native resume works.

---

## 7. SKILL.md body (template to author in PR 4)

```
# Skill: Diff-Scoped Broken Access Control Exploitation

Use this skill when given a pull request diff and a running target app (vulnbank).
The ONLY legal target is vulnbank. Never probe anything else.

1. Call scope_surface(diff) to get new/changed routes and whether each has auth.
2. For each NEW route with auth_present == false, or any route whose auth was weakened:
   a. In the sandbox, send a request with NO Authorization header.
      If it returns 2xx with a data body -> broken access control. Capture full request AND response.
   b. Send the same request with a valid token for a DIFFERENT tenant.
      If it returns another tenant's data -> cross-tenant leak. Capture request AND response.
   c. If the route looks admin-only, send with a valid NON-admin token.
      If it returns 2xx -> missing role enforcement. Capture request AND response.
3. A route is EXPLOITED only if a probe returned data it should not have AND you captured a request+response.
   No proof, no finding. Otherwise CLEAN.
4. Redact Authorization header values before recording anything.
5. Hand the finding to the auditor subagent. Do NOT seal or post until auditor_ok is true.
6. After auditor_ok: call seal_evidence(finding).
7. If EXPLOITED: block the merge and post the request/response as a PR comment.
   If CLEAN: propose the merge, then STOP and wait for human approval before merging.
```

The probe is code the agent **generates and runs in the sandbox** — do not hardcode it in the repo.

---

## 8. Deployment

| Piece | Where | How |
|---|---|---|
| TrueForge harness | **Render** | Hosted mode: container/Docker Compose, managed **Postgres + Redis**. Set `PUBLIC_BASE_URL` to the Render URL. Holds all model + GitHub + Daytona secrets as Render env vars. |
| attesta-mcp | **Render** | Second service (or co-located). Reads R2 + Postgres creds from Render env. Exposes the MCP URL registered in TrueForge. |
| vulnbank | **Render** (fallback probe target) + GitHub | Sandbox boots it from source normally; Render URL is the hour-1 fallback. |
| Dashboard | **Vercel** | One env var: the Render TrueForge API URL. No model keys. |
| Postgres | Render managed | `ledger` table + TrueForge storage. |
| R2 | Cloudflare | Content-addressed artifact store for sealed evidence. |

Secrets: TrueForge holds model/GitHub/Daytona keys; attesta-mcp holds R2 + Postgres; dashboard holds only the TrueForge URL. Nothing secret in any repo or the video.

---

## 9. Version/fact checklist to confirm at hour 0 (don't trust, verify)
- [ ] Node 22.14+ installed (TrueForge requirement).
- [ ] `deepseek/deepseek-v4-pro-0813` is the correct current slug (or adjust).
- [ ] TrueForge custom-MCP example transport (stdio vs HTTP/SSE) — match it.
- [ ] Daytona: one sandbox can both boot the app and probe localhost (else use Render fallback URL).
- [ ] SDK exposes pending-approval state (else use request_human_approval fallback).
- [ ] Render can run hosted-mode TrueForge (Compose + managed Postgres + Redis) on your Pro plan.
