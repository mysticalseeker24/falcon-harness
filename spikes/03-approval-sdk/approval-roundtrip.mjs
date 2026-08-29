// Spike 03 — read + action a pending approval as an external client. THROWAWAY (delete before PR 2).
//
// Proves unknown #3 (PROJECT_SPEC §10.1 / §8): the dashboard can read a pending approval and
// approve/deny it. Driven over the TrueForge HTTP API (localhost:8790) — the same endpoints
// @truefoundry/trueforge-sdk wraps. Zero dependencies (Node 24 global fetch).
//
// Preconditions: TrueForge running; the `mcp-ping` server (spike 01) registered + running;
// the `openrouter/glm5.3-flash` model configured.
//
// Run:  node approval-roundtrip.mjs      (or TF=http://host:port node approval-roundtrip.mjs)
//
// Mechanism confirmed 2026-08-29:
//   - require approval per MCP server via `require_approval_for_tools` (here set inline on the
//     session's agent spec so `ping` pauses).
//   - the agent's turn ends with a `tool.approval_required` event carrying `thread_id` +
//     `tool_calls[].id`.
//   - resume by POSTing a new turn whose input is a `user.tool_approval` item with the
//     `thread_id`, `tool_call_id`, and `approval: { status: "allow" | "deny" }`.

const BASE = process.env.TF || "http://localhost:8790";

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: { "content-type": "application/json" }, ...opts });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
function collectByType(obj, wanted, out = []) {
  if (obj && typeof obj === "object") {
    if (obj.type === wanted) out.push(obj);
    for (const v of Object.values(obj)) collectByType(v, wanted, out);
  }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);
const statusOf = (t) => t?.state?.status ?? t?.state?.type ?? t?.status ?? null;

async function pollTurn(sessionId, turnId, label) {
  let turn = null;
  for (let i = 0; i < 75; i++) {
    const g = await api(`/api/v1/sessions/${sessionId}/turns/${turnId}`);
    turn = g.body?.data ?? g.body;
    const st = statusOf(turn);
    if (st && st !== "running") { console.log(`${label} state after ${i}s:`, st); return turn; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${label} still running after timeout`);
  return turn;
}

async function main() {
  const create = await api("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      agent: { spec: {
        model: { name: "openrouter/glm5.3-flash" },
        instructions: "You are a test agent. When asked to call the ping tool, call the mcp-ping `ping` tool with the given message. Do nothing else.",
        mcp_servers: [{ name: "mcp-ping", enable_tools: ["@all"], require_approval_for_tools: ["ping"], preload: true }],
      } },
    }),
  });
  const sessionId = create.body?.data?.id ?? create.body?.id;
  console.log("session:", create.status, sessionId);

  const t1 = await api(`/api/v1/sessions/${sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({ input: [{ type: "user.message", content: "Call the ping tool with message hello." }], stream: false }),
  });
  const turnId = t1.body?.data?.id ?? t1.body?.id;
  console.log("trigger turn:", t1.status, turnId);

  const turn = await pollTurn(sessionId, turnId, "trigger-turn");
  const approvals = collectByType(turn, "tool.approval_required");
  if (approvals.length === 0) { console.log("NO approval event. turn:\n", j(turn)); return; }
  console.log("READ pending approval:\n", j(approvals[0]));

  const ev = approvals[0];
  const threadId = ev.thread_id ?? turn?.thread_id;
  const toolCallId = ev.tool_calls?.[0]?.id ?? ev.tool_calls?.[0]?.tool_call_id;
  if (!threadId || !toolCallId) { console.log("could not extract ids"); return; }

  const appr = await api(`/api/v1/sessions/${sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({ input: [{ type: "user.tool_approval", thread_id: threadId, tool_call_id: toolCallId, approval: { status: "allow" } }], stream: false }),
  });
  console.log("approve (allow):", appr.status);
  if (appr.status >= 400) { console.log(j(appr.body)); return; }
  const turn2Id = appr.body?.data?.id ?? appr.body?.id ?? turnId;

  const turn2 = await pollTurn(sessionId, turn2Id, "resume-turn");
  const blob = j(turn2) ?? "";
  console.log(blob.includes("pong")
    ? "\n*** SPIKE 3 PASS: read + actioned a pending approval; agent resumed and ran ping. ***"
    : "\n*** resume turn (trimmed) ***\n" + blob.slice(0, 4000));
}
main().catch((e) => console.error("driver error:", e));
