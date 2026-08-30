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
| `audit_change(diff, target_base_url?, probes?, seal?)` | **Flagship.** Static advisory for unguarded new endpoints; if a running `target_base_url` + `probes` are given, executes them, derives EXPLOITED/CLEAN/INCONCLUSIVE from the real responses, and (with `seal`) independently audits + seals the proof | model for seal-audit |
| `suggest_guard(method, route, framework?, note?)` | Proposes the middleware/guard to add (advisory, never auto-applied) | model |
| `explain_finding(entry_hash)` | Plain-language explanation of a sealed entry (verdict, endpoint, PR, different-family auditor) | — |
| `seal_evidence` / `verify_ledger` | The hash-chained proof layer | model for seal |

## The as-you-code loop

1. You add a route. The agent calls `audit_change(diff)` → gets *"`GET /admin/x` has no auth guard"*
   (a **static advisory**, instant, no sandbox).
2. If a dev server is running, the agent calls `audit_change(diff, target_base_url, probes)` → gets a
   **proof**: the captured unauthenticated request returning `200` + data, verdict `EXPLOITED`.
3. The agent calls `suggest_guard(...)` → gets the exact middleware to add, and fixes it **before the
   PR** — instead of Falcon catching it at PR time.

Static advisory is a heuristic (regex over the diff, no reachability) — a prompt to check, not a
proof. The proof is the executed exchange. That distinction is deliberate and always labelled.
