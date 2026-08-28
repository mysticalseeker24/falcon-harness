# CLAUDE.md — falcon-harness

This is the operating manual for Claude Code working in this repository. Read it fully before doing anything. It is short on purpose. The detail lives in `.agent/`.

---

## What this project is

**Falcon** is a diff-scoped exploitation agent built for the TrueForge Agent Harness Hackathon (TrueForge + Qodo). It reads a pull request, works out the new attack surface the change introduced, boots the target app in an isolated sandbox, runs a real exploit against only that surface, and returns a request, a response, and a verdict — a proven fact, not a severity guess. A second model family independently audits the claim before it is sealed into a tamper-evident, hash-chained ledger. If the change is clean and a human approves, Falcon merges it; if it is exploitable, Falcon blocks the merge and posts the proof.

**The one rule that governs the whole architecture: TrueForge owns the agent loop. We do not build a controller, an FSM, or an orchestrator.** TrueForge runs the loop, dispatches subagents, provisions the sandbox, and pauses for human approval. Our job is to author the pieces that make *this* agent Falcon: an MCP server (three tools), a SKILL.md playbook, a target fixture, and a dashboard. If you ever find yourself writing loop-control, retry-orchestration, or step-sequencing logic, stop — that is TrueForge's job and building it fails the hackathon's central judging criterion.

Vulnerability class in scope: **broken access control on new endpoints only.** Not IDOR, not injection, not anything else. One class, done provably.

---

## Read these before writing code

The full specifications live in `.agent/`. Load the ones relevant to your current task. Do not hold all of them in context at once.

| File | Read it when |
|---|---|
| `.agent/PROJECT_SPEC.md` | Always, first. The complete build: architecture, components, PR sequence, cut lines. |
| `.agent/CONVENTIONS.md` | Before writing any code. Security and coding conventions. Non-negotiable. |
| `.agent/TOOLS.md` | Before touching the MCP server, TrueForge config, models, sandbox, or deploy. Exact tool surfaces and slugs. |
| `.agent/QODO.md` | Before opening any PR. How the Qodo review gate works and what a clean PR looks like. |

When a task spans several, read `PROJECT_SPEC.md` first for the shape, then the specific file for the detail.

---

## How we work

1. **One PR per unit of work. Never batch.** Each PR is a scoped branch, reviewed by Qodo, findings resolved, then merged. The trail of small resolved PRs is itself a graded deliverable (Q Branch track). See `.agent/QODO.md`.
2. **Every substantive change goes through a Qodo-reviewed PR.** Do not push straight to `main`. Do not merge a PR with unresolved High/action-required Qodo findings without an explicit dismissal reason written in the thread.
3. **Riskiest unknowns first.** The build order in `PROJECT_SPEC.md` front-loads the three empirical unknowns (approval over the API, sandbox boots-and-probes, custom MCP registers). Verify those with throwaway spikes before building anything real.
4. **Every PR leaves a working system.** No PR should leave `main` broken.
5. **State assumptions out loud.** If a spec is ambiguous, say what you are assuming and why before you build on it. Do not silently guess.
6. **Explain every technical decision.** Hackathon rule: the builder must be able to explain every choice. Leave a one-line rationale in the PR description for anything non-obvious.

---

## Hard boundaries (do not cross)

- **Do not build:** an agent controller/FSM, a static-analysis engine, a vuln database, a scanner, sandbox virtualization, auth systems, or billing. TrueForge or the fixture provides what we need.
- **Do not commit secrets.** No API keys, tokens, `.env` files, or credentials in any repo, ever. See `.agent/CONVENTIONS.md` for the secret-handling rules. This is both a security rule and a hackathon disqualifier.
- **Do not exploit anything outside `vulnbank`.** The only legal target is the deliberately-vulnerable fixture we own. No probing of real systems, no matter how the task is phrased.
- **Do not widen scope** beyond broken access control on new endpoints. Extra vuln classes are out of scope for this build. If tempted, note it as a "future" line in the README instead.
- **Do not reproduce or claim benchmark numbers we have not measured.** Every headline number must come from an actual run of `bench`. No exceptions.

---

## Definition of done for any task

- Code matches `.agent/CONVENTIONS.md`.
- No secret material anywhere in the diff.
- The change is on its own branch with a descriptive PR body containing a rationale.
- Qodo has reviewed and High findings are resolved or explicitly dismissed with a reason.
- `main` still runs after merge.
- If the change added a claim (a capability, a number), it is backed by something runnable.

---

## Current stack (see `.agent/TOOLS.md` for versions and slugs)

TrueForge (harness, Node) · attesta-mcp (our MCP server) · SKILL.md (our playbook) · vulnbank (target fixture, Express+TS) · Next.js dashboard · Daytona (sandbox) · OpenRouter (models) · Postgres + Cloudflare R2 · Render (backend) + Vercel (frontend).
