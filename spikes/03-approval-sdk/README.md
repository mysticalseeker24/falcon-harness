# Spike 03 — dashboard reads + actions a pending approval

**Unknown (PROJECT_SPEC §10.1 / §8):** can an external client (the dashboard) read a pending
approval and approve/deny it? **Answered YES — native path**, driven over the TrueForge HTTP API
(the same endpoints `@truefoundry/trueforge-sdk` wraps). No `request_human_approval` fallback needed.

## The confirmed mechanism (2026-08-29)

The harness has a first-class human-checkpoint model — discovered from `/api/v1/openapi.json`:

1. **Mark tools as approval-gated** per MCP server via `require_approval_for_tools`
   (`@all` / `@write` / `@destructive` / literal names; default `["@write","@destructive"]`).
   The driver sets it inline on the session's agent spec so the read-only `ping` tool pauses.
2. **Read** — when the agent calls a gated tool, its turn ends with a `tool.approval_required`
   event carrying `thread_id` and `tool_calls[].id`. (Also surfaced in the turn's `pending_actions`
   and the `/turns/{id}/events` stream.)
3. **Action** — POST a new turn whose `input` is a `user.tool_approval` item:
   `{ type:"user.tool_approval", thread_id, tool_call_id, approval:{ status:"allow"|"deny" } }`.
   The agent then resumes (or the call is denied).

This is exactly what the dashboard's blocking approval card needs (PR 5 gate, PR 9 card). The
durable version of this note lives in `.agent/TOOLS.md` §6.

## Run

Preconditions: TrueForge up; `mcp-ping` (spike 01) registered + running; `openrouter/glm5.3-flash`
configured. Then (zero dependencies — Node 24 global fetch):

```bash
cd spikes/03-approval-sdk
node approval-roundtrip.mjs
```

## PASS criterion (met)

Driver output shows: `READ pending approval` (with `thread_id`/`tool_call_id`) → `approve (allow) 200`
→ resume turn containing `pong`. I.e. an external client read the pending approval and actioned it,
and the agent resumed. Confirmed end to end.

## Fallback (not needed)

If the native path had been unavailable, the plan was a `request_human_approval(summary)` MCP tool
the dashboard flips via a DB flag. It is unnecessary — the native `user.tool_approval` resume works.
