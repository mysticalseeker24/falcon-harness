# Falcon dashboard

The Best-UI surface — a **Next.js** evidence console that runs a Falcon review and renders the proof:
the live activity timeline, the captured request/response, the verdict, the human-approval gate, and
the tamper-evident ledger. Design language: a "carbon & brass" forensic console — greyscale carries
the structure, antique brass marks the brand + sealed evidence, and saturated color is reserved
strictly for verdicts (red = EXPLOITED, green = CLEAN, amber = INCONCLUSIVE).

It holds **no** model or GitHub keys — those live in the TrueForge harness. It reads the real
`attesta-mcp` ledger and verifies it through the `verify_ledger` MCP tool.

## Run

```bash
cp .env.example .env.local           # point at attesta-mcp's ledger + MCP url
npm install
npm run dev                          # http://localhost:3000
npm run build && npm start           # production
npm test                             # ledger + replay logic (node --test)
npm run typecheck                    # tsc --noEmit
```

For the ledger panel to show real entries, run `attesta-mcp` (from `../attesta-mcp`) so its
`data/ledger.jsonl` exists and its MCP server is up on `:8130`.

## Verification (`npm test`)

`npm test` runs the automated suite in [`test/`](./test) (also gated in CI, `.github/workflows/ci.yml`,
required before merge). It covers the capabilities this console claims: canonical serialization
agreement with attesta, corrupt-row tolerance on read (a bad line renders as `CORRUPT`, never a
crash), and the demo tamper/restore state machine — the demo gate, back-up-once, the deliberately
stale hash that makes `Verify` catch the edit, and restore-verified-before-backup-deletion. Live
byte re-verification itself is the `verify_ledger` MCP tool, tested in `../attesta-mcp`.

## Panels

- **Command bar** — pick the vulnbank PR (#3 vuln / #4 safe) and **Replay run** (a faithful replay of
  a recorded run — the live agent run happens in the TrueForge harness).
- **Activity (replay)** — Scoping → Booting sandbox → Probing → Auditing → Sealing, labelled as the
  replay it is.
- **Evidence** — the captured request (Authorization redacted) and response; the money shot is the
  no-token request returning `200` + every tenant's balances. Shows the independent-auditor chip
  (a *different* model family than the writer).
- **Verdict** — EXPLOITED / CLEAN / INCONCLUSIVE, with the sealed `entry_hash`.
- **Approval card** — appears on CLEAN. This is a **replay** of the gate: it records your Approve/Reject
  choice but does **not** itself fire a merge or seal an approval. In a live run that gate lives in the
  harness — the agent seals an `APPROVAL` entry *before* resuming the TrueForge merge (GATE.md).
- **Ledger** — the `prev → entry` hash chain; **Verify chain** (calls `verify_ledger`, which re-reads
  the bytes) turns green. The DEMO-badged **Tamper**/**Restore** buttons appear **only** when the
  server is started in demo mode (`ATTESTA_DEMO=1`) against a *demo* ledger — Tamper mutates a row so
  Verify turns red and names the broken entry, and Restore reverts. See the safe-demos note below.

## Modes — what is replay vs. live

The console is explicit about which parts are real:

- **Run Falcon → replay.** Driven by `lib/demo.ts` (actual captured evidence), it does **not** seal.
  After it finishes it reconciles the replayed `entry_hash` against the live ledger and labels the
  verdict banner accordingly — *"in live ledger"* when the hash is really present, *"replay · not in
  live ledger"* otherwise. It never reports a fresh seal it did not perform.
- **Approval → replay.** Records the decision only (see the Approval-card note above).
- **Verify chain → live.** A real trust boundary: `verify_ledger` over MCP re-reads the bytes and
  recomputes the chain. Bounded by a finite timeout, so an unavailable verifier surfaces as a visible
  failure, never a hung request.
- **Tamper / Restore → live, but demo-gated.** See below.

## Notes — safe demos & the road to production

- **Tamper/Restore are refused unless explicitly enabled.** The API rejects them with `403` unless
  the server runs with `ATTESTA_DEMO=1` **and** `ATTESTA_LEDGER_PATH` names a *demo* ledger (the path
  basename must contain `demo`) — so a runtime request can never mutate canonical evidence. When
  enabled, the operation is serialized in-process and atomic: it backs the ledger up **once** (never
  clobbering the one clean copy), keeps the now-stale `entry_hash` so `Verify` catches the edit, and
  verifies the restore before deleting the backup. Run the demo against a dedicated file that attesta
  is not concurrently appending to, e.g. `ATTESTA_DEMO=1 ATTESTA_LEDGER_PATH=./data/demo-ledger.jsonl
  npm start` (from `../attesta-mcp`), and point this console at the same file. `Verify chain` stays a
  real, live trust boundary regardless.
- **Toward production** (not needed for the demo): replace the replay timing with an
  **authenticated live TrueForge run** streamed over the SDK, and resolve the approval through the
  real `tool.approval_required` → `user.tool_approval` flow (GATE.md) with the approver derived from
  the dashboard's authenticated session — rather than the local replay timing + local approval
  resolution used here for a deterministic demo surface.

## Qodo Code Review Evidence

This surface was built through Qodo-reviewed PRs (the Q-Branch trail). The dashboard PR drew a
detailed compliance review — Qodo flagged the honesty gaps and demo-safety issues that this revision
resolves: unbounded `verify_ledger` (now finite-timeout), silent HTTP/exception swallowing (now
status-checked with server-side logging and generic client errors), the destructive tamper/restore
endpoints exposed to any caller (now `ATTESTA_DEMO`-gated, demo-path-guarded, serialized, atomic,
backup-once), corrupt rows that could crash hash rendering (now a safe `CORRUPT` view model), and
`Run Falcon`/`Approve` that overclaimed sealing/merge (now labelled replay, reconciled against the
live ledger). Each fix has a corresponding test in `test/` and is enforced in CI.
