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
