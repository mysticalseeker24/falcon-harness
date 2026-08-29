# Spike 03 — dashboard reads + actions a pending approval over the SDK

**Unknown (PROJECT_SPEC §10.1 / §8, TOOLS.md §6):** can a client (the future dashboard) read the
pending-approval state and approve it over `@truefoundry/trueforge-sdk`? This decides the
highest-value 90 seconds of the demo — a **native approval card** vs a fallback tool.

> The exact SDK method names are not documented here on purpose. `spike.mjs` **introspects** the
> SDK (prints its exports and client methods) and then tries a guarded best-guess flow. Use the
> printed surface + the SDK docs at trueforge.dev to confirm the real names. (`package.json` pins
> `latest` for now — replace with the resolved version once installed, per CONVENTIONS §7.)

## Setup

1. TrueForge running locally, with **one tool marked "requires approval"** so a run can pause on
   it. Easiest: mark the **GitHub merge** tool as requiring approval (TOOLS.md §5 / §1 step 5).
   For a pure spike with no GitHub, mark any harmless tool as requiring approval and trigger it.
2. Start a session in the TrueForge chat that calls that tool, so the run **pauses on a pending
   approval**. Note the session id if the UI shows one.

## Run

```bash
cd spikes/03-approval-sdk
npm install
TRUEFORGE_API_URL=http://localhost:8790 SPIKE_SESSION_ID=<paused-session-id> node spike.mjs
```

Read the output: it prints the SDK's real surface, then whether a **read** of pending approvals
and an **approve** call succeeded.

## PASS criterion

A read call returns the pending approval **and** an approve call resumes the paused run (the tool
then executes). That answers the unknown **YES → native approval card**; the dashboard (PR 9) will
render a blocking card from this SDK state.

## If it fails — fallback (`request_human_approval`)

If the SDK cannot read or action approvals cleanly, take the spec fallback (PROJECT_SPEC §8,
TOOLS.md §6): add a small MCP tool

```
request_human_approval(summary: string) -> { approved: boolean }
```

that **blocks** until the dashboard flips a flag (a row in Postgres the dashboard writes). The
SKILL calls it before merge on the CLEAN path. It reuses the spike-01 MCP server pattern plus one
polled DB flag. Build it only if this spike returns NO. Record "native SDK" vs
"request_human_approval" in the repo-root **Spike results** table.
