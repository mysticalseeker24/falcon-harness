# Falcon

**A diff-scoped exploitation agent built on TrueForge.** Falcon reads a pull request, works out the new attack surface the change introduced, boots the app in an isolated sandbox, runs a real exploit against only that surface, and returns a request, a response, and a verdict — a proven fact, not a severity guess. A second model family independently audits the claim before it is sealed into a tamper-evident, hash-chained ledger. If the change is clean and a human approves, Falcon merges it; if it is exploitable, Falcon blocks the merge and posts the proof.

> **Result:** 1/1 planted flaw caught, 0 false alarms across 1 healthy control, 3 runs each — all verdicts correct. Reproduce with `cd attesta-mcp && npm run bench` (it boots the real fixture, probes it, audits on a different model family, seals + verifies, and exits non-zero on any wrong verdict).

Built for the TrueForge Agent Harness Hackathon (TrueForge + Qodo). TrueForge owns the agent loop, the sandbox, the approval gate, and the subagents; Falcon is the diff-scoped exploitation engine on top.

---

## What it does

- **Scopes** the new attack surface a PR introduces (broken access control on new endpoints).
- **Exploits** it for real in an isolated Daytona sandbox — captures the actual request and response.
- **Audits** every finding with an independent model from a different family before anyone sees it.
- **Seals** results into a hash-chained ledger you can verify by re-reading the bytes.
- **Gates** the merge: clean changes wait for human approval; exploitable ones are blocked with proof.

## Scope (stated plainly)

One vulnerability class (broken access control on new endpoints), one language (JS/TS via Express), regex-based diff scoping, no reachability pruning. Deliberately narrow, done provably.

## How it uses TrueForge

TrueForge owns the loop; Falcon is the four authored pieces that plug into it:

- **MCP server (`attesta-mcp`)** — registered over Streamable HTTP, three tools: `scope_surface`
  (the new attack surface from the diff), `seal_evidence` (audits the finding, then hash-chains it),
  and `verify_ledger` (recomputes the chain and re-reads the artifact bytes).
- **`SKILL.md` playbook** — loaded as the agent's operating instructions: scope → clone the PR head
  SHA in the sandbox → boot + health-probe → generate access-control probes → `seal_evidence` → act.
- **Daytona sandbox** — provisioned by TrueForge; the agent installs Node in-sandbox, boots
  `vulnbank`, and probes it on localhost (one sandbox boots *and* probes — de-risked in PR 1).
- **Independent auditor** — runs *inside* `seal_evidence` on a **different model family** (GLM auditor
  vs DeepSeek writer); a deterministic gate the model can only veto, never rubber-stamp.
- **Human-approval checkpoint** — the CLEAN path proposes the merge and pauses on TrueForge's
  `tool.approval_required`; approval resumes it via `user.tool_approval`, and the approval is sealed to
  the ledger **before** the irreversible merge fires (see [`.agent/GATE.md`](./.agent/GATE.md)).
- **No secrets in our code** — model and GitHub credentials live in the harness; `attesta-mcp` and the
  dashboard hold none.

## Spike results (PR 1)

Three empirical unknowns from `.agent/PROJECT_SPEC.md` §10, de-risked with throwaway spike code
under [`spikes/`](./spikes) (deleted before PR 2). Fill each row after running the spike; if a
primary path fails, take the named fallback and note it here.

| # | Unknown | Result | Decision / fallback taken | Date |
|---|---|---|---|---|
| 1 | Custom MCP server registers + one tool call round-trips | **PASS** | Streamable HTTP; registered as `mcp-ping`, harness discovered the tool, agent invoked it and got `pong`/echo/timestamp. No fallback needed. | 2026-08-29 |
| 2 | One Daytona sandbox boots the app **and** probes it on localhost | **PASS** | Single sandbox: agent wrote the app, booted it, and read `/data` (200, secret) via both curl and a self-generated Node probe on localhost. No Render fallback. **Note:** base image ships no Node — agent installed Node 22.14 itself; real vulnbank boot must install Node in-sandbox (or use a Node image). | 2026-08-29 |
| 3 | Dashboard reads + actions a pending approval over the TrueForge SDK | **PASS** | Proven **through `@truefoundry/trueforge-sdk`**: `client.sessions.create` + `createTurn` paused on `tool.approval_required`, read `threadId`/`toolCallId`, then `createTurn` with a `user.tool_approval` `allow` item resumed the agent. No `request_human_approval` fallback. Endpoints the SDK wraps: TOOLS.md §6. | 2026-08-29 |

Fallbacks (from the spec): (1) if Streamable-HTTP registration fails, match the transport
TrueForge's own MCP example uses (SSE or stdio); (2) if one sandbox can't both boot and probe,
deploy the target to a Render URL and probe that; (3) if the SDK can't read/action approvals, add
a `request_human_approval(summary)` MCP tool the dashboard flips via a DB flag.

## Run it

**Prerequisites:** Node 24, an [OpenRouter](https://openrouter.ai) API key (for the auditor), and —
for the full harness run — a [Daytona](https://daytona.io) key. On Windows, run TrueForge under WSL2
(a native-Windows ESM path bug crashes it; see [`.agent/upstream-issue-draft.md`](./.agent/upstream-issue-draft.md)).

```bash
cp .env.example .env                 # set OPENROUTER_API_KEY (+ DAYTONA_API_KEY for the live run)
```

**The proof, without the harness** — boot the fixture, run the real pipeline, measure the headline:

```bash
cd attesta-mcp && npm install
npm run typecheck && npm test        # 43 unit tests
npm run bench                        # boots vulnbank ×3/branch, prints the verdict matrix
npm start                            # (optional) MCP server on :8130 for the dashboard
```

**The console** — the evidence surface, reading the real ledger:

```bash
cd dashboard && npm install
cp .env.example .env.local           # point at attesta-mcp's ledger + MCP url
npm run dev                          # http://localhost:3000
```

**The full agent run** — run TrueForge (under WSL2), register `attesta-mcp` as a custom MCP server,
import `SKILL.md` at the repo root, and point it at a `vulnbank` PR. The step-by-step is in
[`.agent/SPINE.md`](./.agent/SPINE.md).

## `npm run bench`

The product's own test of its headline claim — no asserted numbers, only measured ones.

```bash
cd attesta-mcp && npm run bench     # needs OPENROUTER_API_KEY (read from ../.env)
```

For each vulnbank demo branch, **×3**, it: boots the **real** fixture, probes it over HTTP,
derives the verdict from the responses (a CLEAN verdict needs *positive proof on both sides* — every
deny probe actually denied **and** an authorized probe returned real balances), runs the real
attesta-mcp pipeline (`scope_surface` on the diff → audit on a **different model family** →
`seal_evidence` → `verify_ledger`), prints a **verdict matrix**, and **exits non-zero if any verdict
is wrong**. A failing `bench` is a build breakage.

Scenarios and the diff baseline are **pinned to immutable commit SHAs** so a rerun measures exactly
the same code, and every run records a checked-in artifact at
[`attesta-mcp/bench-results/latest.json`](./attesta-mcp/bench-results/latest.json) (pinned SHAs, the
full row matrix, and measured metrics) so the headline below has a matching, reproducible record.

Measured run (2026-08-30, `bench-results/latest.json`):

```
scenario   run  expected     got          scope  seal              result
vuln       1    EXPLOITED    EXPLOITED    ok     sealed+verified   PASS
vuln       2    EXPLOITED    EXPLOITED    ok     sealed+verified   PASS
vuln       3    EXPLOITED    EXPLOITED    ok     sealed+verified   PASS
safe       1    CLEAN        CLEAN        ok     sealed+verified   PASS
safe       2    CLEAN        CLEAN        ok     sealed+verified   PASS
safe       3    CLEAN        CLEAN        ok     sealed+verified   PASS

1/1 planted flaw caught, 0 false alarms across 1 healthy control, 3 runs each — all verdicts correct.
```

---

## Qodo Code Review Evidence

Every substantive change shipped as its own branch, reviewed by Qodo, findings resolved, then merged —
the trail of small resolved PRs is itself a deliverable. Selected reviews:

| PR | What Qodo surfaced | What changed |
|---|---|---|
| [#13 — dashboard](https://github.com/mysticalseeker24/falcon-harness/pull/13) | 13 compliance findings: unbounded `verify_ledger`, silently-swallowed HTTP/exception failures, destructive tamper/restore exposed to any caller, corrupt rows crashing hash rendering, and `Run Falcon`/`Approve` overclaiming a seal/merge | Finite-timeout verify; status-checked API with server-side logging + generic client errors; `ATTESTA_DEMO`-gated, atomic, backup-once tamper; safe `CORRUPT` view model; honest replay labelling reconciled against the live ledger |
| [#9 — auditor](https://github.com/mysticalseeker24/falcon-harness/pull/9) | 9 findings on the independent auditor: forgeable pass boolean, same-family risk, unredacted evidence to the model | Moved the audit *inside* `seal_evidence`; enforced a different model family; deterministic gate the model can only veto; redact-before-model |
| [#5 — MCP ledger tools](https://github.com/mysticalseeker24/falcon-harness/pull/5) | 7 findings on `scope_surface` / hashing: auth detection from non-middleware args, unanchored route regex, canonicalization edge cases | One canonical serializer; anchored extraction; `__proto__`-as-data hashing |
| [#11 — bench](https://github.com/mysticalseeker24/falcon-harness/pull/11) | 7 findings: mutable branch refs, CLEAN accepted on bare 2xx, configured-not-measured metrics, raw stack traces | Pinned immutable SHAs + recorded artifact; CLEAN needs proven balances; measured metrics; redacted internal error log |

**Follow-up review against final code:** each fix commit was re-reviewed by Qodo on the same PR before
merge, and CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs both workspaces'
typecheck + test suites on every PR and push to `main`.

---

## Built with AI (disclosure)

This project was built with Claude Code as the coding assistant, under the direction and review of the author, who can explain every technical decision. Fittingly, Falcon exists because AI writes clean-looking code that can be measurably riskier — so we built the thing that verifies it by execution rather than reading it.

## License

MIT — see [LICENSE](./LICENSE).
