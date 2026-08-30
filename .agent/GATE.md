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
with a `tool.approval_required` event. The **authenticated approval handler** (the dashboard, PR 9)
surfaces it to a human. On approve, the **handler — not the agent** — does these steps **in this
order**:

1. **Derive the approver identity from its own trusted session/auth context**, never from
   model-supplied MCP arguments. (The main agent must not seal APPROVAL entries; only the
   authenticated handler does.)
2. **Seal the approval first and require success:**
   `seal_evidence({ verdict:"APPROVAL", approver, approves_entry_hash:<the CLEAN finding's hash>, target_repo, pr_number })`.
   attesta-mcp rejects this unless the hash resolves to a prior **CLEAN** finding for the same repo
   and PR.
3. **Only if the seal succeeded**, submit `user.tool_approval` `allow` to resume the merge.

This ordering is deliberate: sealing **before** resuming means a failed seal can never leave an
irreversible merge without a matching APPROVAL entry. On reject/deny → no seal, no merge.

**INCONCLUSIVE** — never proposes a merge; nothing to approve (SKILL.md §7).

## Exact approval mechanics (from spike 03 / TOOLS.md §6)

- Pause event: `tool.approval_required` carries `thread_id` + `tool_calls[].id`.
- Resume: `client.sessions.createTurn(sessionId, { input: [{ type: "user.tool_approval", thread_id, tool_call_id, approval: { status } }] })`
  (raw: POST `/api/v1/sessions/{id}/turns`).

## Status (what is verified vs. planned)

- **Verified now (unit-tested in attesta-mcp):** `seal_evidence` APPROVAL entries — an approval
  links `approver` + the `approves_entry_hash` of a prior CLEAN finding for the same repo+PR, carries
  no HTTP artifact, and the chain still verifies. Referential + hash-shape validation is enforced.
- **Designed, not shipped as an automated handler:** the full pause → seal → resume → merge
  sequence, including the trusted-identity derivation and the seal-before-resume ordering above. The
  dashboard ships **Approve as a labelled replay** of this decision (it records the choice; it does
  not itself derive an authenticated approver, seal, or resume the merge). Both primitives it would
  compose are proven — the SDK approval round-trip (spike 03) and `seal_evidence` APPROVAL entries
  (unit-tested) — but the end-to-end authenticated handler that wires them together is the documented
  design here, not a running integration. **Do not claim the live allow → merge → seal flow runs.**
