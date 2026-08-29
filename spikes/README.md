# Spikes (PR 1) — throwaway, delete before PR 2

These three spikes de-risk the empirical unknowns in `.agent/PROJECT_SPEC.md` §10 **before** we
build anything real. They are deliberately minimal and intentionally **not** production code:

- Written in plain ES-module / CommonJS JavaScript (no TypeScript build step) so "does it run"
  is answered in seconds. The real components (`attesta-mcp`, dashboard, `vulnbank`) are
  TypeScript per `.agent/CONVENTIONS.md` §2 — the spikes are exempt because they are scaffolding
  that gets deleted (see `REVIEW.md`: Qodo skips clearly-marked spike code).
- No secrets in any file. Keys come from the local `.env` / the TrueForge harness, never here.

| Spike | Unknown answered | Spec fallback if it fails |
|---|---|---|
| `01-mcp-ping` | Does a custom MCP server register in TrueForge and get one tool call round-tripped? | Match the transport TrueForge's own MCP example uses (SSE or stdio) instead of Streamable HTTP. |
| `02-daytona-probe` | Can **one** Daytona sandbox boot a trivial Express app **and** let a probe hit it on localhost? | Deploy the target to a Render URL; have the sandbox probe that URL. |
| `03-approval-sdk` | Can the dashboard read and action a **pending approval** over the TrueForge SDK? | Add a `request_human_approval(summary)` MCP tool the dashboard flips via a DB flag. |

Run each per its own `README.md`. Record the outcome (and any fallback taken) in the
**Spike results (PR 1)** table in the repo-root `README.md`. Do not start PR 2 until all three
rows are answered.

**Cleanup:** once results are recorded, delete `spikes/` (`git rm -r spikes/`) in the same PR or
a follow-up, keeping only the README results table.
