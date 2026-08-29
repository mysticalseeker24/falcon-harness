# SPINE.md — running Falcon's core loop (PR 4)

The spine is the Double-O core: **fetch a vulnbank PR diff → `scope_surface` → boot vulnbank in the
Daytona sandbox → generate + run a probe → verdict with a captured request/response.** TrueForge
owns the loop; we configure it and supply `SKILL.md` + the MCP tools. This doc is the exact wiring
so the spine is reproducible.

## Prerequisites (configured earlier)

- TrueForge running (WSL, Node 24) at `http://localhost:8790`.
- OpenRouter models registered; main agent = `openrouter/glm5.3-flash` (cheap for iteration;
  switch to `deepseek/deepseek-v4-pro-0813:exacto` for the demo/bench).
- Daytona sandbox key configured (`status: ready`).

## Wire the spine

1. **Run `attesta-mcp`** (a second WSL terminal), from `attesta-mcp/`:
   ```bash
   npm install && npm start        # http://127.0.0.1:8130/mcp
   ```
   Register it in TrueForge → Settings → Connectors → Add MCP Server → `http://localhost:8130/mcp`.
   It exposes `scope_surface`, `seal_evidence`, `verify_ledger`.

2. **Add GitHub MCP** → Settings → Connectors. Auth: a GitHub token scoped to `DevLab-mgc/vulnbank`
   (read PR diff, post PR comment, merge PR). Store the token in the harness, never in the repo.

3. **Import the skill** → Settings → Skills → Import from GitHub → `mysticalseeker24/falcon-harness`
   → `SKILL.md`.

4. **Sandbox** — Daytona is already the sandbox provider. The base image ships without Node, so the
   skill tells the agent to install Node before booting vulnbank (proven in spike 02).

## Run the demo (TrueForge chat)

Paste a target PR and let the agent follow the skill:

> Review `DevLab-mgc/vulnbank` PR #3 for broken access control. Use the diff-scoped skill: scope the
> new surface, boot vulnbank in the sandbox, generate and run the probe, and give me the verdict with
> the captured request and response.

Expected on the **vuln** PR (#3): `scope_surface` flags `GET /admin/balances` with `auth_present:
false` → the agent boots vulnbank, sends a no-`Authorization` request → `200` + every tenant's
balances → **EXPLOITED**, with the request/response captured. On the **safe** PR (#4): same route,
`auth_present: true` → no-token `401`, non-admin `403` → **CLEAN**.

## Scope of PR 4 vs later PRs

The spine proves **scope → boot → probe → verdict** with captured evidence. `SKILL.md` also names the
audit, seal, and gate steps; those are enabled by later configuration:

- **PR 5 (the gate):** mark the GitHub **merge** tool as requiring approval; merge on CLEAN, block +
  comment on EXPLOITED. (Approval mechanism confirmed in spike 03 / TOOLS.md §6.)
- **PR 6 (the auditor):** configure a subagent on a different model family that must return
  `auditor_ok` before the main agent may seal or post.
- **PR 7 (ledger wired):** the flow calls `seal_evidence` after `auditor_ok`; `verify_ledger` +
  the tamper demo. (The tools already exist in `attesta-mcp`.)
