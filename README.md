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

## The target — `vulnbank`

Falcon needs a **legal, controlled, reproducible** thing to exploit, so we built one:
[**DevLab-mgc/vulnbank**](https://github.com/DevLab-mgc/vulnbank) — a small multi-tenant "bank" API
(Express 5 + TypeScript) that is the **only** target Falcon is ever pointed at. It is deliberately
hardened so that **only the intentionally-planted flaw is exploitable** — every other route enforces
authentication, role, and tenant isolation correctly. That matters: it means an `EXPLOITED` verdict is
a real finding on a real bug, not noise, and a `CLEAN` verdict is meaningful.

The demo runs on two pull requests against it, which are the whole point of a *diff-scoped* agent:

| PR | Branch | The change | Correct verdict |
|---|---|---|---|
| **#3** | `pr/admin-balances-vuln` | adds `GET /admin/balances` **with no auth middleware** — it returns every tenant's balances to anyone | **EXPLOITED** |
| **#4** | `pr/admin-balances-safe` | adds the same route **guarded** (`requireAuth` + admin role) | **CLEAN** |

Same endpoint, one line of difference — Falcon tells them apart by *executing* the exploit, not by
reading the code. (The fixture ships its own Qodo config; note that Qodo may still flag vulnbank's
*intentional* vuln — that's expected, it's a deliberately-vulnerable fixture.)

## How it uses TrueForge

TrueForge owns the loop; Falcon is the four authored pieces that plug into it. The **exact agent spec**
(model + MCP servers + skill + sandbox + approval gating), with reproduction steps and the verified
live-run evidence, is in [`.agent/TRUEFORGE-AGENT.md`](./.agent/TRUEFORGE-AGENT.md).

- **MCP server (`attesta-mcp`)** — registered over Streamable HTTP. Three **core** tools:
  `scope_surface` (the new attack surface from the diff), `seal_evidence` (audits the finding, then
  hash-chains it), and `verify_ledger` (recomputes the chain and re-reads the artifact bytes) — plus
  three **as-you-code** tools (`audit_change`, `suggest_guard`, `explain_finding`) for any MCP coding
  agent ([`attesta-mcp/docs/USING-FALCON-MCP.md`](./attesta-mcp/docs/USING-FALCON-MCP.md)).
- **`SKILL.md` playbook** — loaded as the agent's operating instructions: scope → clone the PR head
  SHA in the sandbox → boot + health-probe → generate access-control probes → `seal_evidence` → act.
- **Daytona sandbox** — provisioned by TrueForge; the agent installs Node in-sandbox, boots
  `vulnbank`, and probes it on localhost (one sandbox boots *and* probes — de-risked in PR 1).
- **Independent auditor** — runs *inside* `seal_evidence` on a **different model family** (GLM auditor
  vs DeepSeek writer); a deterministic gate the model can only veto, never rubber-stamp.
- **Human-approval checkpoint (designed flow)** — by design the CLEAN path pauses on TrueForge's
  `tool.approval_required` and is resumed with a `user.tool_approval` item. Both halves exist and are
  proven: that resume-over-the-SDK round-trip is PR 1's approval spike, and `seal_evidence` appends the
  `APPROVAL` entry (sealed **before** the merge, [`.agent/GATE.md`](./.agent/GATE.md)). The end-to-end
  authenticated handler that wires them together is the documented design — not a shipped automated
  integration; the dashboard's Approve is a labelled replay of that decision.
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

Each block below starts **from the repository root** (open a new shell, or `cd` back to root between
them). `npm start` and `npm run bench` auto-load the root `.env`.

**The proof, without the harness** — boot the fixture, run the real pipeline, measure the headline:

```bash
cd attesta-mcp && npm install
npm run typecheck && npm test        # 45 unit tests
npm run bench                        # boots vulnbank ×3/branch, prints the verdict matrix
npm start                            # (optional) MCP server on :8130 for the dashboard
```

**The console** — the evidence surface, reading the real ledger (from the repo root):

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

**Every substantive change shipped as its own branch, reviewed by Qodo, with findings resolved before
merge — the trail of small, reviewed, resolved PRs is itself a graded deliverable (the Q Branch
track).** Nothing went straight to `main`.

**The loop, for every PR:**

1. Open a scoped branch → **Qodo reviews it automatically** and posts findings (bug / security / compliance / rule-violation, by severity).
2. **Resolve** each finding in a follow-up commit — or dismiss it with a written reason in the thread.
3. **Qodo re-reviews the fix commit** on the same PR, and re-flags anything a first fix missed (this caught real second-order bugs — see the deep-dive).
4. **CI** ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs both workspaces' typecheck + test suites on the PR.
5. **Merge** only when clean.

**The trail — findings surfaced → what changed:**

| PR | Findings | Qodo surfaced | Resolved by |
|---|---|---|---|
| [#5 · MCP ledger tools](https://github.com/mysticalseeker24/falcon-harness/pull/5) | 7 | auth detected from non-middleware args; unanchored route regex; canonicalization edge cases | one canonical serializer; anchored extraction; `__proto__`-as-data hashing |
| [#8 · spine](https://github.com/mysticalseeker24/falcon-harness/pull/8) | 3 | branch-name checkout; over-broad token; an unverified run cited as a result | exact head-SHA checkout (fork-aware); least-privilege per-operation PAT; the run labelled "observed once," not a measured claim |
| [#9 · auditor](https://github.com/mysticalseeker24/falcon-harness/pull/9) | 9 | forgeable `auditor_ok` boolean; same-family risk; unredacted evidence sent to the model | audit moved *inside* `seal_evidence`; different family enforced; redact-before-model; deterministic veto-only gate |
| [#11 · bench](https://github.com/mysticalseeker24/falcon-harness/pull/11) | 7 | mutable branch refs; CLEAN accepted on a bare 2xx; configured-not-measured metrics; raw stack traces | pinned immutable SHAs + recorded artifact; CLEAN needs proven data; measured metrics; redacted internal log |
| [#13 · dashboard](https://github.com/mysticalseeker24/falcon-harness/pull/13) | 13 | unbounded `verify_ledger`; silently-swallowed failures; destructive endpoints exposed to any caller; corrupt rows crashing render; `Run`/`Approve` overclaiming a seal/merge | finite-timeout verify; status-checked API + generic errors; `ATTESTA_DEMO`-gated atomic tamper; safe `CORRUPT` model; honest replay labelling |
| [#15 · deploy](https://github.com/mysticalseeker24/falcon-harness/pull/15) | 4 (+2 re-flagged) | destructive `/mcp` unauthenticated; non-transactional seed publish; `/ledger` bypassing the canonical serializer | token-gated mutation surface; **transactional + recoverable** seed; single canonical serializer on the wire (deep-dive ↓) |
| [#16 · as-you-code tools](https://github.com/mysticalseeker24/falcon-harness/pull/16) | 9 | host-side probing outside the sandbox (an SSRF primitive); loose verdict semantics | **removed the host-execution surface entirely** — the principled fix, matching Falcon's own "the sandbox is the boundary" thesis |
| [#17 · dashboard UI](https://github.com/mysticalseeker24/falcon-harness/pull/17) | 2 (+1 re-flagged) | "data leaked" inferred from HTTP status alone; masthead/badge overclaiming a live run | label from the *verified verdict*; honest masthead + a real ledger-live signal; the run clearly marked a replay |

That's **50+ findings resolved** across the reviewed PRs, every one fixed or dismissed with a written reason.

**Deep-dive — the loop catching a second-order bug (PR #15).** Qodo's first pass flagged that seed
publication wasn't transactional; we fixed it — and Qodo's **re-review re-flagged it**: our fix still
wrote the ledger *before* copying the artifacts it references, so a crash mid-copy would leave an
invalid chain that every later boot would silently accept. The real fix was to copy artifacts **first**,
commit the ledger marker **last** via an atomic rename, add a recovery path, and route the `/ledger`
response through the *single* canonical serializer rather than a second `JSON.stringify`. That is the
review loop doing exactly its job — catching the bug the first fix missed.

---

## Built with AI (disclosure)

This project was built with Claude Code as the coding assistant, under the direction and review of the author, who can explain every technical decision. Fittingly, Falcon exists because AI writes clean-looking code that can be measurably riskier — so we built the thing that verifies it by execution rather than reading it.

## License

MIT — see [LICENSE](./LICENSE).
