# PROJECT_SPEC.md — Falcon

The complete build specification. This is the source of truth for architecture, components, and sequencing. Read `CONVENTIONS.md`, `TOOLS.md`, and `QODO.md` for the detail behind the pointers here.

---

## 1. What Falcon is (the pitch, verbatim for README and video)

Falcon is a diff-scoped exploitation agent. It reads a pull request, works out exactly what new attack surface the change introduced, boots the app in an isolated sandbox, runs a real exploit against only that surface, and returns a request, a response, and a verdict — a fact, not a severity guess. A second model family independently audits the claim before anyone sees it. Every result is sealed into a tamper-evident hash-chained ledger. If the change is clean and a human approves, Falcon merges it; if it is exploitable, Falcon blocks the merge and posts the proof. Built on TrueForge, which owns the loop, the sandbox, the approval gate, and the subagents.

**Headline number (measured by `bench`, put first everywhere):** N planted flaws caught, 0 false alarms across M healthy controls, 3 runs each, all verdicts correct. `bench` reproduces it and exits non-zero if any verdict is wrong.

**Vulnerability class:** broken access control on new endpoints. Call the new route with no token and with a wrong-tenant token; observe the status code. Nothing else.

---

## 2. The load-bearing architecture decision

**TrueForge owns the loop. We do not build a controller.**

TrueForge is the harness: it runs the agent loop, dispatches subagents, provisions the Daytona sandbox, manages context and sessions, and pauses for human approval on sensitive tool calls. All of that is configuration, not code we write. Building our own FSM/controller inside it fails the hackathon's central criterion ("the harness does the work, not a thin wrapper") and wastes the day.

We author exactly four things:
1. **`attesta-mcp`** — an MCP server exposing three tools (`scope_surface`, `seal_evidence`, `verify_ledger`).
2. **`SKILL.md`** — the broken-access-control exploitation playbook the agent loads on demand.
3. **`vulnbank`** — the deliberately-vulnerable target fixture (separate repo, under DevLab-mgc org).
4. **The dashboard** — Next.js, the Best UI surface, drives TrueForge via its SDK.

Everything else (sandbox, approvals, subagents, session persistence, model switching) is TrueForge, configured through its UI/YAML catalogs. See `TOOLS.md` for exactly how each is wired.

```
┌─────────────────────────────┐
│  Falcon dashboard (Next.js) │  ← Vercel. Best UI surface.
│  drives via trueforge SDK   │
└──────────────┬──────────────┘
               │ HTTP API / SSE
┌──────────────▼──────────────────────────────────────────────┐
│  TrueForge harness  (Render, hosted mode: Postgres + Redis)  │
│   agent loop · subagent dispatch · approval gate · session   │
│   ├─ GitHub MCP ........... read PR diff, post comment, MERGE │
│   ├─ attesta-mcp (OURS) ... scope_surface, seal, verify       │
│   ├─ Daytona sandbox ...... boot target app, run the probe    │
│   ├─ SKILL.md (OURS) ...... broken-access-control playbook    │
│   └─ Auditor subagent ..... different model family verifies   │
└──────────────────────────────────────────────────────────────┘
        scans ▼
┌─────────────────────────────┐
│  vulnbank (target repo)     │  ← deliberately vulnerable, our own
│  main + 2 PR branches       │
└─────────────────────────────┘
```

---

## 3. Repositories

| Repo | Role | PRs | Where |
|---|---|---|---|
| `mysticalseeker24/falcon-harness` | our agent code: MCP server, SKILL, dashboard, bench, docs | **our** PRs, reviewed **by Qodo** | exists, MIT |
| `DevLab-mgc/vulnbank` | the vulnerable target app | the PRs **Falcon scans** | create fresh |
| TrueForge | the harness | — | run from npm / Docker |

`falcon-harness` PRs are the Q Branch evidence trail. `vulnbank` PRs are the product demo input. **Never conflate them.** Both created inside the Aug 24–30 window (rule 8): confirm `falcon-harness` initial commit is scaffold-only with no substantial pre-window code.

---

## 4. The fixture: `vulnbank`

A tiny Express + TypeScript multi-tenant banking API. Small enough to boot in seconds in the sandbox, real enough that access-control bugs matter.

**`main` (baseline, all safe):**
- `authMiddleware`: reads `Authorization: Bearer <token>`, sets `req.tenantId` and `req.role`. Tokens are seed data: `tenant-a-token`, `tenant-b-token`, `admin-token`.
- `GET /health` → public, `{ok:true}`.
- `GET /accounts/:id` → protected; returns the account only if it belongs to `req.tenantId`, else 403.

**Two PR branches Falcon scans (the whole demo):**

1. **`pr/admin-balances-vuln`** — adds `GET /admin/balances` returning every tenant's balances, registered **without** `authMiddleware`.
   - Expected verdict: no-token request → 200 + data → **EXPLOITED**, merge blocked, proof posted.
2. **`pr/admin-balances-safe`** — the *same-looking* diff (a new admin route exposing balances) but **with** `authMiddleware` + an admin-role check.
   - Expected verdict: no-token → 401; tenant-token (non-admin) → 403 → **CLEAN**, merge proposed, waits for approval.

The safe branch is the differentiator. It looks alarming and is fine. Falcon passing it with zero false alarms is straight from Attesta's Phase-1 zero-false-alarm criterion, and almost no other hackathon project will demonstrate it.

Seed data: two tenants, a couple of accounts each, one admin. Hardcode it. Boot: `npm install && npm start`, listen on `:3000`.

---

## 5. `attesta-mcp` — the three tools

Full tool signatures, ledger schema, and the exact MCP framework/registration are in `TOOLS.md`. Summary:

- **`scope_surface(diff)`** → `{ routes: [{method, path, handler, auth_present, source_line}] }`. Regex over added (`+`) diff lines for new Express route registrations; detect whether an auth middleware is attached. Regex is fine and stated as honest scope in the README. No tree-sitter.
- **`seal_evidence(finding)`** → `{entry_hash}`. Appends a hash-chained entry to the `ledger` table (Postgres). Artifact (request/response blob) stored content-addressed in R2.
- **`verify_ledger()`** → `{valid, length, broken_at}`. Recomputes the chain from genesis AND re-reads the sealed artifact bytes from storage and re-hashes them — do not trust the DB row. This "re-read the bytes" discipline is what makes the tamper demo real.

---

## 6. `SKILL.md` — the exploitation playbook

A git-backed SKILL.md the agent loads on demand (TrueForge Settings → Skills → Import from GitHub). It encodes the *method* in prose the model follows. The probe itself is code the agent **generates and runs in the sandbox** — do not hardcode the probe in our repo; the agent writing and running it live is the sandboxed-execution criterion judges must see. Full skill body template is in `TOOLS.md`.

Core logic the skill enforces:
1. Call `scope_surface(diff)` → new/changed routes + auth presence.
2. For each new route with `auth_present == false`, or weakened auth: in the sandbox, probe with (a) no Authorization header, (b) a different-tenant token, (c) a non-admin token against an admin route. Capture full request AND response each time.
3. EXPLOITED only if a probe returned data it should not have, AND a request+response was captured. No proof, no finding.
4. Hand the finding to the auditor subagent. Do not seal or post until `auditor_ok`.
5. After `auditor_ok`: `seal_evidence`. If EXPLOITED → block merge, post proof as PR comment. If CLEAN → propose merge, STOP, wait for human approval.

---

## 7. The auditor subagent

TrueForge dispatches subagents natively (isolated context, returns only the result). Configure one auditor on a **different model family** than the main agent. It receives raw evidence (request, response, status) + the claim, returns `{auditor_ok, reason}`. The main agent may not seal or post until `auditor_ok`. This is the "the writer is never its own verifier" rule, live. Model assignment (main = DeepSeek V4 Pro, auditor = GPT-5.6 Sol Pro, dev/fast = GLM-5.3-Flash) and the family-independence guarantee are in `TOOLS.md`.

---

## 8. The approval gate (highest-value 90 seconds of the demo)

**The irreversible action is the merge, not the comment.** Mark the GitHub MCP merge tool as requiring human approval (TrueForge human checkpoint — tool approval). Flow:
- CLEAN path: Falcon proposes merge → TrueForge pauses → dashboard shows a blocking approval card → human clicks Approve → merge fires → the approval itself is sealed to the ledger (who, which PR, on what proof, when).
- EXPLOITED path: block merge, post proof comment, no approval offered.

Verify in hour 1 whether approval state is readable/actionable over the SDK. If native, use the native card. If awkward, fall back to a `request_human_approval(summary)` MCP tool that blocks until the dashboard flips a flag. Either satisfies the criterion. Detail in `TOOLS.md`.

---

## 9. The dashboard (Best UI track)

Next.js on Vercel, driving TrueForge via `@truefoundry/trueforge-sdk`; optionally embed chat via `@truefoundry/trueforge-ui` where it saves time. Forensic dark theme, monospace for evidence. Panels:
1. **Command bar** — paste target PR URL / pick a branch, "Run Falcon".
2. **Live activity timeline** — Scoping → Booting sandbox → Probing → Auditing → Sealing, streaming from the session. ("shows what it's doing")
3. **Evidence drawer** — the actual request, response, status in terminal styling. The no-token request returning 200 + data is the money shot.
4. **Verdict** — big EXPLOITED (red) / CLEAN (green).
5. **Approval card (blocking)** — "Falcon proposes merge of vulnbank PR #N (CLEAN). Irreversible. [Approve] [Reject]." The Best UI winner: shows what it's doing, what it's waiting on, what it did, and asks before the irreversible step.
6. **Ledger panel** — entries with `prev_hash → entry_hash`, a "Verify chain" button that goes green, and a demo-only, visibly-badged **Tamper** button to show Verify going red and naming the broken entry.

Never let the dashboard block the core. TrueForge's own chat UI is a valid interface for the Double-O track; the dashboard is purely additive for Best UI.

---

## 10. FIRST 90 MINUTES — verify three unknowns before building anything real

Front-load the empirical risks with throwaway spikes. If one fails, take the fallback immediately; do not debug.

1. **Dashboard-drives-TrueForge-and-actions-approval over the SDK?** Yes → native approval card. No → `request_human_approval` MCP-tool fallback.
2. **Daytona boots the Express app and lets a generated probe hit it inside the same sandbox?** Yes → one sandbox does everything. No → deploy `vulnbank` to a Render URL and have the sandbox probe that URL. Both count as sandboxed execution.
3. **Custom MCP server registers and gets called by the TrueForge agent?** Register `attesta-mcp` via Settings → Connectors → Add MCP Server, expose one trivial tool, confirm one round-trip before writing the real three.

Write the answers into the README as you go — they are also the blog-post material.

---

## 11. PR sequence (the Q Branch trail — do not batch)

Each is a scoped branch on `falcon-harness`, reviewed by Qodo, High findings resolved or dismissed-with-reason, then merged. Qodo GitHub app + config in place before PR 1 (see `QODO.md`). Riskiest unknowns first; every PR leaves a working system.

| PR | Content | ~hrs | After this you have |
|---|---|---|---|
| 0 | Docs + Qodo config: this `.agent/` tree, root CLAUDE.md, `.pr_agent.toml`, `best_practices.md`, README skeleton (with `## Qodo Code Review Evidence` stub + AI-use disclosure), MIT LICENSE, `.gitignore` | 0.5 | Qodo reviewing from commit one |
| 1 | Three throwaway spikes for §10 unknowns; delete after, record results in README | 1 | de-risked plan |
| 2 | `vulnbank`: `main` + 2 PR branches, seed data (separate repo) | 2 | something to scan |
| 3 | `attesta-mcp`: 3 tools, `ledger` table, R2 artifact store | 2 | scoping + sealing callable |
| 4 | **The spine**: TrueForge agent config + `SKILL.md`; fetch diff → scope → boot sandbox → generate+run probe → verdict w/ captured req/resp | 3 | **Double-O core, demoable in TrueForge chat UI** |
| 5 | **The gate**: approval before merge; GitHub merge on clean path; block+comment on vuln path | 1.5 | control-and-safety beat |
| 6 | **The auditor** subagent (different model family) gating every finding | 1.5 | independence claim, live |
| 7 | **The ledger**: hash chain wired after auditor; `verify` re-reads bytes; tamper detection | 2 | tamper-evident evidence |
| 8 | Dashboard core: command bar, timeline, evidence drawer, verdict | 4 | Best UI surface |
| 9 | Dashboard gate + ledger: approval card, ledger panel, Verify button, demo Tamper button | 2 | Best UI winner |
| 10 | `bench` (all branches ×3, prints matrix, exits non-zero on any wrong verdict) + polish + one upstream TrueForge issue/PR | 2 | the measured headline number |

**Cut line if time collapses:** PR4 → PR5 → PR7 → PR6 → PR8/9. Everything through PR7 is a strong Double-O + valid Q Branch submission running in TrueForge's own UI. The dashboard is the only safely-droppable piece.

---

## 12. The four "winner discipline" additions

Adapted from the two Backblaze-hackathon winners (FirstFrame, Takegraph), both of which won on evidentiary discipline — "nothing here claims to work because a function returned success."

1. **Headline number, measured, named run** — README para 1, video first 15s, write-up. (PR 10)
2. **`bench`** — one command, all branches ×3, prints the matrix, exits non-zero if any verdict wrong. This is Attesta's Phase-1 harness, ~1hr. (PR 10)
3. **Tamper demo** — edit a ledger row, hit Verify, chain goes red and names the entry; verify re-reads bytes, does not trust the row; badge it DEMO. (PR 7 + 9)
4. **Upstream contribution** — one well-documented TrueForge issue or small PR for a rough edge hit during the build. Strongest possible "harness was central" signal to a TrueFoundry judge. (PR 10, ~30 min)

Plus, free: state limits plainly in the README (one vuln class, one language, regex scoping, no reachability pruning). Reads as confidence.

---

## 13. Demo video (~3 min)

1. 0:00–0:15 — headline number + one line: AI writes clean-looking code that's measurably riskier; review reads it, Falcon runs it.
2. 0:15–1:05 — vuln PR: paste, Run. Timeline scope → boot sandbox → generate+run probe. Land it. Evidence drawer: no-token request → 200 + data. EXPLOITED. Merge blocked, proof posted.
3. 1:05–1:35 — auditor beat (second family confirms before posting). Ledger seals. Verify chain green.
4. 1:35–2:15 — healthy PR: same scary diff. Run. CLEAN, zero false alarm. Falcon proposes merge → approval card → Approve → merge fires → approval sealed to ledger.
5. 2:15–2:35 — Tamper button → Verify goes RED, names broken entry. Then refresh mid-run to show session survives reconnect.
6. 2:35–3:00 — one line of architecture: TrueForge is the harness, Falcon is the exploitation engine on top. Close on: it produces a fact, not an opinion.

Film the exploit and the gate as separate, unmissable beats. Everyone films the exploit; almost nobody films the gate, and it is 1/6 of the score.

---

## 14. Submission checklist (rule 10)

- [ ] Public `falcon-harness`, README a stranger can run
- [ ] `## Qodo Code Review Evidence` section: a real merged-PR link + a follow-up review against final code
- [ ] ~3-min demo video showing the agent working
- [ ] Short write-up: what Falcon does + how it uses TrueForge
- [ ] AI-use disclosed (built with Claude Code — on message: we build with agents, so we built the thing that verifies them)
- [ ] Blog post published + linked (Field Report track)
- [ ] Submit **Aug 30 morning IST** (deadline 00:30 IST Aug 31 — do not fly that close)

---

## 15. Qodo narrative (a Qodo person scores you)

Frame Qodo and Falcon as **complementary layers**, never replacement. Qodo reviewed the code Falcon is written in; Falcon exploit-tested the kind of code Qodo reviews. Static review catches one class of thing, execution catches another. **Keep the F1 50.3% benchmark stat entirely out of the repo, video, and write-up.** Full detail in `QODO.md`.
