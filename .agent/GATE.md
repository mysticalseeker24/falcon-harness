# GATE.md — the approval gate (PR 5)

The highest-value 90 seconds of the demo. **The irreversible action is the merge, not the comment.**
Falcon may block a merge and post proof on its own, but it must never merge without a human. The
approval mechanism was confirmed native in spike 03 (TOOLS.md §6).

## What we configure

1. **Mark the GitHub `merge` tool as requiring approval** — TrueForge tool-approval checkpoint, set
   per MCP server via `require_approval_for_tools` on the GitHub connector (include the merge tool;
   e.g. `merge_pull_request`). The **comment** tool is NOT approval-gated — only merge is.
2. The rest is behavior the agent already follows from `SKILL.md` §7.

## The two paths

**EXPLOITED** — Falcon blocks the merge and posts the captured request + response as a PR comment
(the proof). No approval is offered; nothing is merged.

**CLEAN** — Falcon proposes the merge. Because the merge tool is approval-gated, the turn **pauses**
with a `tool.approval_required` event. An approver (the dashboard, PR 9, or the TrueForge UI) reads
it and resolves it via `user.tool_approval` `{ status: "allow" | "deny" }`:
- **allow** → the merge fires, then **the approval is sealed to the ledger**:
  `seal_evidence({ verdict: "APPROVAL", approver, approves_entry_hash: <the CLEAN finding's hash>, pr_number })`
  — who approved which finding, and when, in the same hash chain.
- **deny** → no merge.

**INCONCLUSIVE** — never proposes a merge; nothing to approve (SKILL.md §7).

## Exact approval mechanics (from spike 03 / TOOLS.md §6)

- Pause event: `tool.approval_required` carries `thread_id` + `tool_calls[].id`.
- Resume: `client.sessions.createTurn(sessionId, { input: [{ type: "user.tool_approval", thread_id, tool_call_id, approval: { status } }] })`
  (raw: POST `/api/v1/sessions/{id}/turns`).
- Reference driver: the spike-03 approach; the dashboard (PR 9) renders the blocking card from this
  state and calls the resume.

## Sealing the approval

`seal_evidence` accepts `verdict: "APPROVAL"` with `approver` + `approves_entry_hash` and no
request/response (attesta-mcp). The approval entry links to the finding it approved, so the ledger
shows the full story: finding → audit → approval → merge.
