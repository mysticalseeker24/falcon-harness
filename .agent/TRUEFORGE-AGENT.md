# TRUEFORGE-AGENT.md — the exact TrueForge agent that *is* Falcon

This documents the precise TrueForge configuration that turns the harness into **Falcon**. TrueForge
owns the loop; this file is the config we author on top of it. It is the literal spec used to drive
the verified live runs (see **Proof** at the bottom), so a judge can reproduce Falcon exactly.

> **The one rule, restated:** we do **not** build a controller/FSM/orchestrator. Everything below is
> *declarative agent configuration* handed to TrueForge — a model, two MCP servers, a skill, and a
> sandbox toggle. TrueForge runs the loop, dispatches tools, provisions the sandbox, and pauses for
> human approval.

## The agent spec (inline, verbatim)

TrueForge configures the agent **inline per session** (there is no separate "agents library" entry —
`GET /api/v1/agents` is empty by design). This is the exact `agent.spec`:

```json
{
  "model": { "name": "openrouter/deepseekv4-pro" },
  "mcp_servers": [
    {
      "name": "github",
      "enable_tools": ["pull_request_read"],
      "require_approval_for_tools": ["@write", "@destructive"],
      "preload": true
    },
    {
      "name": "attesta-mcp",
      "enable_tools": ["@all"],
      "require_approval_for_tools": ["@write", "@destructive"],
      "preload": true
    }
  ],
  "skills": [{ "name": "diff-scoped-broken-access-control" }],
  "config": {
    "iteration_limit": 200,
    "sandbox": { "enabled": true, "file_downloads": true },
    "dynamic_sub_agents": { "enabled": true },
    "context_management": { "compaction": { "enabled": true }, "large_tool_response": { "enabled": true } },
    "generative_ui": { "enabled": true },
    "ask_user_questions": { "enabled": true }
  }
}
```

## What each part does

| Field | Value | Why |
|---|---|---|
| `model.name` | `openrouter/deepseekv4-pro` | The **writer** (main agent). Registered in TrueForge → maps to OpenRouter `deepseek/deepseek-v4-pro-0813:exacto`. The independent audit runs on a **different family** (GLM) inside `seal_evidence`, so this model can never rubber-stamp itself. |
| `mcp_servers[github]` | `enable_tools: [pull_request_read]` | Read the PR + its diff, read-only. **Writes gated:** `require_approval_for_tools: ["@write","@destructive"]` puts the **merge** (and any comment) behind a human approval — this is the control-safety gate. |
| `mcp_servers[attesta-mcp]` | `enable_tools: [@all]` | Our MCP server: `scope_surface`, `seal_evidence`, `verify_ledger` (+ the as-you-code tools). Its writes are also approval-eligible, but `seal_evidence` is the audited seal, so sealing is not blocked in practice. |
| `skills` | `diff-scoped-broken-access-control` | Our [`SKILL.md`](../SKILL.md) playbook — the method the agent follows (scope → boot → probe → verdict → seal → act). |
| `config.sandbox.enabled` | `true` | TrueForge provisions a **Daytona** sandbox for the run. The skill installs Node in it (the base image ships none) and boots vulnbank there — the target never runs on the host. |
| `config.dynamic_sub_agents` | `true` | TrueForge may spawn sub-agents. Note: they inherit the writer's family, so the **independent** audit deliberately lives *inside* `seal_evidence` on a different family instead (see [GATE.md](./GATE.md)). |
| `iteration_limit`, `compaction`, `large_tool_response` | — | Harness housekeeping: bound the loop, compact long context, summarize large tool outputs. |

## Prerequisites the operator sets up (once)

1. **Models** registered in TrueForge: `openrouter/deepseekv4-pro` (writer) and `openrouter/glm5.3-flash` (auditor family), both via OpenRouter.
2. **`attesta-mcp` MCP server** registered (Connectors → Add MCP Server → `http://localhost:8130/mcp`), started with `OPENROUTER_API_KEY` in its env (the in-seal auditor needs it).
3. **GitHub MCP** registered with a fine-grained token scoped to `DevLab-mgc/vulnbank` (least privilege — see [SPINE.md](./SPINE.md) §2).
4. **Skill imported** from this repo at the **repo root** (`SKILL.md`). A wrong import path breaks the whole sandbox — see SPINE.md.

## Reproduce a run

**Via the TrueForge chat UI (what the demo shows):** open a session with this agent and paste:

> Following your skill, review `DevLab-mgc/vulnbank` PR #3 for broken access control: scope the new
> surface, boot vulnbank in the sandbox, run your probe, and give the verdict with the captured
> request and response.

**Via the API (how these runs were driven headlessly):**

```
POST /api/v1/sessions            body: { "agent": { "spec": { …the spec above… } } }   → session id
POST /api/v1/sessions/{id}/turns body: { "input": [{ "type": "user.message", "content": "<task>" }] }
```

The turn responds as an **SSE stream** (`text/event-stream`); the connection must stay open for the
duration or the turn is cancelled. Events include `turn.created`, `mcp.initialize`, `sandbox.created`,
`tool.response`, and `turn.done`. Approval pauses surface as approval events and, in the UI, as a
clickable approval (resume = a `user.tool_approval` turn).

## Proof — verified live (2026-08-30)

Driven headlessly against the local TrueForge with this exact spec:

- **PR #3 (vuln):** `sandbox.created` (real Daytona sandbox) → cloned head SHA `68cd31e2…`, installed
  Node v22.14.0, booted vulnbank, `/health 200` → unauthenticated `GET /admin/balances` returned
  `200` + every tenant's balances → **EXPLOITED** → sealed `125ef2e792cd…`.
- **PR #4 (safe):** same boot → `401` / `403` / admin `200` → **CLEAN** → sealed `2375e2b4e3bb…`.
- **Gate:** on the CLEAN merge proposal the run **paused for human approval** (the merge is
  `@write` → approval-gated); not approved in the test, so nothing merged.
- **Ledger:** `verify_ledger` → `valid`, all entries re-verify by re-reading artifact bytes.

This upgrades SPINE.md's earlier "observed once" note: the full TrueForge → Daytona → exploit → seal
loop is now reproducibly verified.
