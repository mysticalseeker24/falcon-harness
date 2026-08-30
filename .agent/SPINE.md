# SPINE.md — running Falcon's core loop (PR 4)

The spine is the Double-O core: **fetch a vulnbank PR diff → `scope_surface` → boot vulnbank in the
Daytona sandbox → generate + run a probe → verdict with a captured request/response.** TrueForge
owns the loop; we configure it and supply `SKILL.md` + the MCP tools. This doc is the exact wiring
so the spine is reproducible.

## Prerequisites (configured earlier)

- TrueForge running (WSL, Node 24) at `http://localhost:8790`.
- OpenRouter models registered (TOOLS.md §3); main agent = `z-ai/glm-5.3-flash:exacto` (cheap for
  iteration; switch to `deepseek/deepseek-v4-pro-0813:exacto` for the demo/bench). These appear in
  TrueForge under the harness names `openrouter/glm5.3-flash` / `openrouter/deepseekv4-pro`.
- Daytona sandbox key configured (`status: ready`).

## Wire the spine

1. **Run `attesta-mcp`** (a second WSL terminal), from `attesta-mcp/`:
   ```bash
   npm install && npm start        # http://127.0.0.1:8130/mcp
   ```
   Register it in TrueForge → Settings → Connectors → Add MCP Server → `http://localhost:8130/mcp`.
   It exposes `scope_surface`, `seal_evidence`, `verify_ledger`.

2. **Add GitHub MCP** → Settings → Connectors. Auth: a GitHub fine-grained token scoped to
   `DevLab-mgc/vulnbank`, least-privilege per operation:
   - **Contents: Read and write** — `merge_pull_request` (the merge creates a commit).
   - **Issues: Read and write** — `add_issue_comment` (PR comments post via the issues API).
   - **Pull requests: Read** — `pull_request_read` (read the PR + diff; read-only).
   - **Metadata: Read** — mandatory, auto-selected.

   Store the token in the harness, never in the repo.

3. **Import the skill** → Settings → Skills → Import from GitHub → repo
   `mysticalseeker24/falcon-harness`, **`path` left empty (repo root — `SKILL.md` lives at the root)**,
   ref `main`. **Gotcha (learned the hard way):** `path` is the skill *directory*; a wrong path
   (e.g. `falcon-harness/SKILL.md`) makes the git-skill install fail, which **breaks the whole
   sandbox** (every `exec` errors), not just the skill.

4. **Sandbox** — Daytona is already the sandbox provider. The base image ships without Node, so the
   skill tells the agent to install Node before booting vulnbank (proven in spike 02). Skills require
   `config.sandbox.enabled: true`.

**Auditor (PR 6):** TrueForge's dynamic subagents can't be pinned to a specific model
(`DynamicSubAgentsConfig` only has `enabled`), so a spawned subagent inherits the writer's family —
not independent. Instead the audit lives **inside `seal_evidence`** (attesta-mcp): it independently
audits the probes on a **different model family** (`AUDITOR_MODEL`, default cheap `z-ai/glm-5.3-flash`
vs `WRITER_MODEL` DeepSeek; independence is enforced) and refuses to seal unless the audit passes.
attesta-mcp therefore needs `OPENROUTER_API_KEY` in its env (run it as
`OPENROUTER_API_KEY=… npm start`).

## Run the demo (TrueForge chat)

Paste a target PR and let the agent follow the skill:

> Review `DevLab-mgc/vulnbank` PR #3 for broken access control. Use the diff-scoped skill: scope the
> new surface, boot vulnbank in the sandbox, generate and run the probe, and give me the verdict with
> the captured request and response.

Expected on the **vuln** PR (#3): `scope_surface` flags `GET /admin/balances` with `auth_present:
false` → the agent boots vulnbank, sends a no-`Authorization` request → `200` + every tenant's
balances → **EXPLOITED**, with the request/response captured. On the **safe** PR (#4): same route,
`auth_present: true` → no-token `401`, non-admin `403` → **CLEAN**.

**Verified live (2026-08-30):** the full TrueForge → Daytona → exploit → seal loop was driven
end-to-end against the real PRs — **PR #3 EXPLOITED** and **PR #4 CLEAN** — each provisioning a **real
Daytona sandbox** (`sandbox.created`), booting vulnbank at the exact head SHA, and passing
`verify_ledger` afterward. The merge on the CLEAN path **paused for human approval**. Each live run
seals a fresh entry, so hashes differ per run; the **committed, auditable record** of the same two
verdicts is the seed ledger — EXPLOITED#3 `f0ca81e8…` and CLEAN#4 `b69f0a77…` in
[`attesta-mcp/seed/ledger.jsonl`](../attesta-mcp/seed/ledger.jsonl). The exact agent spec + reproduction
steps are in [TRUEFORGE-AGENT.md](./TRUEFORGE-AGENT.md).

Discipline unchanged: the **headline number** still comes only from a `bench` run — the repeatable,
self-checking harness that boots all branches ×3 and exits non-zero on any wrong verdict — never from
these live runs (CONVENTIONS §8).

## Scope of PR 4 vs later PRs

The spine proves **scope → boot → probe → verdict** with captured evidence. `SKILL.md` also names the
audit, seal, and gate steps; those are enabled by later configuration:

- **PR 5 (the gate):** mark the GitHub **merge** tool as requiring approval; merge on CLEAN, block +
  comment on EXPLOITED. (Approval mechanism confirmed in spike 03 / TOOLS.md §6.)
- **PR 6 (the auditor):** configure a subagent on a different model family that must return
  `auditor_ok` before the main agent may seal or post.
- **PR 7 (ledger wired):** the flow calls `seal_evidence` after `auditor_ok`; `verify_ledger` +
  the tamper demo. (The tools already exist in `attesta-mcp`.)
