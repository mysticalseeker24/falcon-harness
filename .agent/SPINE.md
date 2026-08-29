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
   `DevLab-mgc/vulnbank` — permissions **Contents (R/W)**, **Pull requests (R/W)**, **Issues (R/W)**,
   **Metadata (R)**. Give the agent the tools it needs: `pull_request_read` (diff), `add_issue_comment`
   (proof comment), and `merge_pull_request` (the approval-gated merge). Store the token in the
   harness, never in the repo.

3. **Import the skill** → Settings → Skills → Import from GitHub → repo
   `mysticalseeker24/falcon-harness`, **`path` left empty (repo root — `SKILL.md` lives at the root)**,
   ref `main`. **Gotcha (learned the hard way):** `path` is the skill *directory*; a wrong path
   (e.g. `falcon-harness/SKILL.md`) makes the git-skill install fail, which **breaks the whole
   sandbox** (every `exec` errors), not just the skill.

4. **Sandbox** — Daytona is already the sandbox provider. The base image ships without Node, so the
   skill tells the agent to install Node before booting vulnbank (proven in spike 02). Skills require
   `config.sandbox.enabled: true`.

**Auditor (PR 6):** TrueForge's dynamic subagents are on by default, so the main agent already
spawns a subagent to audit before sealing (observed: `create_sub_agent` → `auditor_ok: true`). PR 6
pins that auditor to a *different model family* (`openai/gpt-5.6-sol-pro`) for true independence.

## Run the demo (TrueForge chat)

Paste a target PR and let the agent follow the skill:

> Review `DevLab-mgc/vulnbank` PR #3 for broken access control. Use the diff-scoped skill: scope the
> new surface, boot vulnbank in the sandbox, generate and run the probe, and give me the verdict with
> the captured request and response.

Expected on the **vuln** PR (#3): `scope_surface` flags `GET /admin/balances` with `auth_present:
false` → the agent boots vulnbank, sends a no-`Authorization` request → `200` + every tenant's
balances → **EXPLOITED**, with the request/response captured. On the **safe** PR (#4): same route,
`auth_present: true` → no-token `401`, non-admin `403` → **CLEAN**.

**Verified live (2026-08-29):** the full loop ran end-to-end against real PR #3 with DeepSeek —
fetch → scope → boot (health `200 {"ok":true}`) → probe (no-token/wrong-tenant/wrong-role all `200`)
→ subagent audit (`auditor_ok: true`) → `seal_evidence` (`entry_hash 278a7085…`, genesis link) →
`verify_ledger` `valid`. Not yet run as a repeatable `bench` (PR 10); this is a single observed run.

## Scope of PR 4 vs later PRs

The spine proves **scope → boot → probe → verdict** with captured evidence. `SKILL.md` also names the
audit, seal, and gate steps; those are enabled by later configuration:

- **PR 5 (the gate):** mark the GitHub **merge** tool as requiring approval; merge on CLEAN, block +
  comment on EXPLOITED. (Approval mechanism confirmed in spike 03 / TOOLS.md §6.)
- **PR 6 (the auditor):** configure a subagent on a different model family that must return
  `auditor_ok` before the main agent may seal or post.
- **PR 7 (ledger wired):** the flow calls `seal_evidence` after `auditor_ok`; `verify_ledger` +
  the tamper demo. (The tools already exist in `attesta-mcp`.)
