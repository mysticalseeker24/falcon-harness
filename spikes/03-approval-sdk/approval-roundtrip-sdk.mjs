// Spike 03 — read + action a pending approval through @truefoundry/trueforge-sdk. THROWAWAY.
//
// Proves the ACTUAL unknown (PROJECT_SPEC §10.1): can the dashboard read a pending approval and
// approve/deny it *through the SDK it will import* — not just the raw HTTP API. Uses the real
// SDK client methods: sessions.create / sessions.createTurn / sessions.getTurn.
//
// Preconditions: TrueForge running; `mcp-ping` (spike 01) registered + running;
// `openrouter/glm5.3-flash` configured. Local standalone has auth disabled, so no token needed.
//
// Run:  npm install && npm start        (or: node approval-roundtrip-sdk.mjs)

import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({ baseUrl: process.env.TF || "http://localhost:8790" });

const j = (x) => JSON.stringify(x, null, 2);
const idOf = (r) => r?.id ?? r?.data?.id;
const statusOf = (t) => t?.state?.status ?? t?.state?.type ?? t?.status ?? null;
const turnOf = (r) => r?.data ?? r; // GetTurnResponse may wrap in { data }

function collectByType(obj, wanted, out = []) {
  if (obj && typeof obj === "object") {
    if (obj.type === wanted) out.push(obj);
    for (const v of Object.values(obj)) collectByType(v, wanted, out);
  }
  return out;
}

async function pollTurn(sessionId, turnId, label) {
  for (let i = 0; i < 75; i++) {
    const t = turnOf(await client.sessions.getTurn(sessionId, turnId));
    const st = statusOf(t);
    if (st && st !== "running") { console.log(`${label} state after ${i}s:`, st); return t; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${label} still running after timeout`);
  return null;
}

async function main() {
  // 1. inline-agent session via SDK: GLM + mcp-ping, ping requires approval
  const session = await client.sessions.create({
    agent: { spec: {
      model: { name: "openrouter/glm5.3-flash" },
      instructions: "You are a test agent. When asked to call the ping tool, call the mcp-ping `ping` tool with the given message. Do nothing else.",
      mcpServers: [{ name: "mcp-ping", enableTools: ["@all"], requireApprovalForTools: ["ping"], preload: true }],
    } },
  });
  const sessionId = idOf(session);
  console.log("session (SDK sessions.create):", sessionId);

  // 2. trigger turn via SDK
  const t1 = await client.sessions.createTurn(sessionId, {
    input: [{ type: "user.message", content: "Call the ping tool with message hello." }],
    stream: false,
  });
  const turnId = idOf(turnOf(t1));
  console.log("trigger turn (SDK sessions.createTurn):", turnId);

  // 3. poll + 4. read pending approval
  const turn = await pollTurn(sessionId, turnId, "trigger-turn");
  const approvals = collectByType(turn, "tool.approval_required");
  if (approvals.length === 0) { console.log("NO approval event. turn:\n", j(turn)); process.exit(1); }
  const ev = approvals[0];
  const threadId = ev.thread_id ?? ev.threadId ?? turn?.thread_id;
  const toolCallId = ev.tool_calls?.[0]?.id ?? ev.toolCalls?.[0]?.id;
  console.log("READ pending approval via SDK — thread:", threadId, "tool_call:", toolCallId);
  if (!threadId || !toolCallId) { console.log("could not extract ids:\n", j(ev)); process.exit(1); }

  // 5. ACTION: approve (allow) via SDK — same createTurn, user.tool_approval item
  const appr = await client.sessions.createTurn(sessionId, {
    input: [{ type: "user.tool_approval", threadId, toolCallId, approval: { status: "allow" } }],
    stream: false,
  });
  const turn2Id = idOf(turnOf(appr)) ?? turnId;
  console.log("approve (SDK sessions.createTurn, user.tool_approval allow):", turn2Id);

  // 6. confirm resume ran ping
  const turn2 = await pollTurn(sessionId, turn2Id, "resume-turn");
  const blob = j(turn2) ?? "";
  console.log(blob.includes("pong")
    ? "\n*** SPIKE 3 PASS (via SDK): sessions.create + createTurn read the pending approval and approved it; agent resumed and ran ping. ***"
    : "\n*** resume turn (trimmed) ***\n" + blob.slice(0, 4000));
}
main().catch((e) => { console.error("SDK driver error:", e?.message ?? e); if (e?.body) console.error("body:", j(e.body)); process.exit(1); });
