// Spike 03 — read + action a pending approval over the TrueForge SDK. THROWAWAY (delete before PR 2).
//
// Unknown (PROJECT_SPEC §10.1 / §8, TOOLS.md §6): can a client (the future dashboard) read the
// pending-approval state raised by a tool marked "requires approval", and approve it, over
// `@truefoundry/trueforge-sdk`? If yes -> native approval card. If no -> request_human_approval fallback.
//
// The exact SDK method names are NOT assumed. This script FIRST introspects the SDK surface and
// prints it, THEN tries a best-guess flow guarded in try/catch. Read the introspection output and
// the TrueForge SDK docs (trueforge.dev) to confirm the real method names, then finalise the row.
//
// Run:  TRUEFORGE_API_URL=http://localhost:8790 SPIKE_SESSION_ID=... node spike.mjs
//   (no secrets in this file; the URL comes from the env / your local .env)

const API_URL = process.env.TRUEFORGE_API_URL;
if (!API_URL) {
  console.error("Set TRUEFORGE_API_URL (e.g. http://localhost:8790). Aborting.");
  process.exit(2);
}

// --- 1. Import + introspect the SDK so we can see what it actually exposes ---------------------
let sdk;
try {
  sdk = await import("@truefoundry/trueforge-sdk");
} catch (err) {
  console.error("Could not import @truefoundry/trueforge-sdk. Run `npm install` first.", err);
  process.exit(2);
}

console.log("=== SDK top-level exports ===");
console.log(Object.keys(sdk));

// Best-guess client construction — adjust the export/ctor name to whatever introspection shows.
const ClientCtor = sdk.TrueForgeClient ?? sdk.Client ?? sdk.default;
if (!ClientCtor) {
  console.error("No obvious client constructor among exports above. Inspect the list and update this script.");
  process.exit(1);
}

const client = new ClientCtor({ baseUrl: API_URL });
console.log("\n=== client methods (look for approval / pending / resume) ===");
console.log(
  [...new Set([
    ...Object.keys(client),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(client) ?? {}),
  ])].sort()
);

// --- 2. Best-guess pending-approval flow, fully guarded ---------------------------------------
// Precondition: a session is mid-run and paused on a tool marked "requires approval" (e.g. the
// GitHub merge on the CLEAN path). Pass its id as SPIKE_SESSION_ID, or adapt to list sessions.
const sessionId = process.env.SPIKE_SESSION_ID ?? null;

async function tryCall(label, fn) {
  try {
    const out = await fn();
    console.log(`\n[OK] ${label}:`, JSON.stringify(out, null, 2));
    return out;
  } catch (err) {
    console.log(`\n[--] ${label} not available / failed:`, err?.message ?? err);
    return undefined;
  }
}

console.log("\n=== attempting to READ pending approvals ===");
const pending =
  (await tryCall("client.approvals.listPending()", () => client.approvals.listPending())) ??
  (await tryCall("client.listPendingApprovals()", () => client.listPendingApprovals())) ??
  (sessionId && (await tryCall("client.sessions.get(pending)", () => client.sessions.get(sessionId))));

console.log("\n=== attempting to ACTION (approve) a pending approval ===");
const approvalId = process.env.SPIKE_APPROVAL_ID ?? pending?.[0]?.id ?? pending?.id ?? null;
if (!approvalId) {
  console.log("No approval id discovered. If READ above worked, set SPIKE_APPROVAL_ID and re-run the approve step.");
} else {
  await tryCall(`approve(${approvalId})`, () =>
    (client.approvals?.approve ? client.approvals.approve(approvalId) : client.approve(approvalId, { decision: "approve" }))
  );
}

console.log(
  "\nVERDICT INPUT: if a READ call returned a pending approval AND an approve call resumed the run,\n" +
  "the SDK supports the native approval card -> answer YES. Otherwise take the request_human_approval\n" +
  "fallback (see README) and record NO."
);
