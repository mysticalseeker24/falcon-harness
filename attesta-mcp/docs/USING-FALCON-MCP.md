# Using Falcon over MCP (as-you-code)

Falcon's `attesta-mcp` is a Model Context Protocol server. Any MCP-capable coding agent (Claude Code,
Cursor, TrueForge, …) can connect to it and audit access control **while writing code** — the static
answer needs no sandbox and is instant.

## Connect

Streamable-HTTP MCP endpoint: `POST <base>/mcp`. Run it locally so private code never leaves your
machine (only the optional model-audit calls go out; point `OPENROUTER_BASE_URL` at an internal
gateway to keep even those in-house). On a shared/hosted instance, `/mcp` requires
`Authorization: Bearer <ATTESTA_MCP_TOKEN>`.

## Tools

| Tool | What it does | Needs |
|---|---|---|
| `scope_surface(diff)` | New routes a diff introduces + whether each has an auth guard | — |
| `audit_change(diff)` | **Flagship.** Static advisory flagging unguarded new endpoints (instant, no sandbox, no execution) | — |
| `suggest_guard(method, route, framework?, note?)` | Proposes the middleware/guard to add (advisory, never auto-applied) | model |
| `explain_finding(entry_hash)` | Plain-language explanation of a sealed entry — verifies the chain first, refuses if it doesn't (returns `integrity_ok:false`) | — |
| `seal_evidence` / `verify_ledger` | The hash-chained proof layer | model for seal |

## The as-you-code loop

1. You add a route. The agent calls `audit_change(diff)` → gets *"`GET /admin/x` has no auth guard"*
   (a **static advisory**, instant, no sandbox).
2. The agent calls `suggest_guard(...)` → gets the exact middleware to add, and fixes it **before the
   PR** — instead of Falcon catching it at PR time.

Static advisory is a heuristic (regex over the diff, no reachability) — a prompt to check, not a
proof. **Execution-proven exploitation is deliberately not done by these tools:** running the target
belongs in the **isolated sandbox** (the agent/harness pipeline that boots the app and seals via
`seal_evidence`), never as a host-side probe from the MCP server. That boundary is the whole point of
Falcon — the tools here are the safe, no-execution surface.
