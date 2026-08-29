# Spike 03 — dashboard reads + actions a pending approval **through the SDK**

**Unknown (PROJECT_SPEC §10.1 / §8):** can the dashboard read a pending approval and approve/deny
it **through `@truefoundry/trueforge-sdk`** — the client it will actually import? **Answered YES.**
Proven end to end through the real SDK client methods (not raw `fetch`). No `request_human_approval`
fallback needed.

## What the driver does (`approval-roundtrip-sdk.mjs`)

All calls go through the SDK client `new TrueForge({ baseUrl })`:

1. `client.sessions.create({ agent: { spec: { model, mcpServers:[{ name:"mcp-ping",
   requireApprovalForTools:["ping"] }] } } })` — inline agent; the read-only `ping` tool is marked
   approval-gated so it pauses.
2. `client.sessions.createTurn(sessionId, { input:[{ type:"user.message", content:"…" }] })` —
   the agent calls `ping` and the turn ends paused.
3. **Read** — `client.sessions.getTurn(...)` surfaces a `tool.approval_required` event carrying
   `threadId` + `toolCalls[].id`.
4. **Action** — `client.sessions.createTurn(sessionId, { input:[{ type:"user.tool_approval",
   threadId, toolCallId, approval:{ status:"allow" } }] })`.
5. The agent resumes and runs `ping` (`pong` in the resume turn).

The underlying HTTP endpoints the SDK wraps are documented in `.agent/TOOLS.md` §6 for the PR 5
gate / PR 9 card. `introspect-sdk.mjs` is the throwaway discovery script that mapped the SDK
surface (`client.sessions.*`).

## Run

Preconditions: TrueForge up; `mcp-ping` (spike 01) registered + running; `openrouter/glm5.3-flash`
configured. Then:

```bash
cd spikes/03-approval-sdk
npm install          # @truefoundry/trueforge-sdk@0.1.3
npm start            # -> node approval-roundtrip-sdk.mjs
```

## PASS criterion (met)

Output shows: `session (SDK sessions.create)` → `READ pending approval via SDK` (thread + tool_call)
→ `approve (SDK … user.tool_approval allow)` → resume turn containing `pong`. An external client
read and actioned the approval **through the SDK**, and the agent resumed.

## Fallback (not needed)

Had the SDK lacked an approval surface, the plan was a `request_human_approval(summary)` MCP tool
the dashboard flips via a DB flag. Unnecessary — `client.sessions.createTurn` with a
`user.tool_approval` item does it natively.
