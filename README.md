# Falcon

**A diff-scoped exploitation agent built on TrueForge.** Falcon reads a pull request, works out the new attack surface the change introduced, boots the app in an isolated sandbox, runs a real exploit against only that surface, and returns a request, a response, and a verdict — a proven fact, not a severity guess. A second model family independently audits the claim before it is sealed into a tamper-evident, hash-chained ledger. If the change is clean and a human approves, Falcon merges it; if it is exploitable, Falcon blocks the merge and posts the proof.

> **Result:** _[headline number here after PR 10 — e.g. N planted flaws caught, 0 false alarms across M healthy controls, 3 runs each, all verdicts correct. Reproduce with `npm run bench`.]_

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

_[fill as built: MCP tools registered, SKILL.md loaded, Daytona sandbox, subagent auditor, human-approval checkpoint on merge, session persistence]_

## Spike results (PR 1)

Three empirical unknowns from `.agent/PROJECT_SPEC.md` §10, de-risked with throwaway spike code
under [`spikes/`](./spikes) (deleted before PR 2). Fill each row after running the spike; if a
primary path fails, take the named fallback and note it here.

| # | Unknown | Result | Decision / fallback taken | Date |
|---|---|---|---|---|
| 1 | Custom MCP server registers + one tool call round-trips | PENDING | — | — |
| 2 | One Daytona sandbox boots the app **and** probes it on localhost | PENDING | — | — |
| 3 | Dashboard reads + actions a pending approval over the TrueForge SDK | PENDING | — | — |

Fallbacks (from the spec): (1) if Streamable-HTTP registration fails, match the transport
TrueForge's own MCP example uses (SSE or stdio); (2) if one sandbox can't both boot and probe,
deploy the target to a Render URL and probe that; (3) if the SDK can't read/action approvals, add
a `request_human_approval(summary)` MCP tool the dashboard flips via a DB flag.

## Run it

_[setup steps a stranger can follow — filled as built]_

## `npm run bench`

_[what it does and the matrix it prints — filled in PR 10]_

---

## Qodo Code Review Evidence

_[mandatory. Filled through the build:]_
- _Representative merged PR reviewed by Qodo: [link]_
- _What Qodo surfaced and what changed: [1–2 sentences]_
- _Follow-up review against final code: [link]_

---

## Built with AI (disclosure)

This project was built with Claude Code as the coding assistant, under the direction and review of the author, who can explain every technical decision. Fittingly, Falcon exists because AI writes clean-looking code that can be measurably riskier — so we built the thing that verifies it by execution rather than reading it.

## License

MIT — see [LICENSE](./LICENSE).
