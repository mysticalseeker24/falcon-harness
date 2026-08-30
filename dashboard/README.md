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
```

For the ledger panel to show real entries, run `attesta-mcp` (from `../attesta-mcp`) so its
`data/ledger.jsonl` exists and its MCP server is up on `:8130`.

## Panels

- **Command bar** — pick the vulnbank PR (#3 vuln / #4 safe) and **Run Falcon**.
- **Live activity** — Scoping → Booting sandbox → Probing → Auditing → Sealing.
- **Evidence** — the captured request (Authorization redacted) and response; the money shot is the
  no-token request returning `200` + every tenant's balances. Shows the independent-auditor chip
  (a *different* model family than the writer).
- **Verdict** — EXPLOITED / CLEAN / INCONCLUSIVE, with the sealed `entry_hash`.
- **Approval card** — appears on CLEAN: propose merge → **Approve** (irreversible) → the approval is
  sealed to the ledger.
- **Ledger** — the `prev → entry` hash chain; **Verify chain** (calls `verify_ledger`, which re-reads
  the bytes) turns green; the DEMO-badged **Tamper** button mutates a row so Verify turns red and
  names the broken entry, and **Restore** reverts.

## Modes

The run is a faithful **replay** of a real Falcon run (reliable for the demo), driven by
`lib/demo.ts` (the actual captured evidence). The ledger/verify/tamper are **live** against
`attesta-mcp`. A live TrueForge run adapter (streaming a real session) can be layered on the same
`RunState` model.
