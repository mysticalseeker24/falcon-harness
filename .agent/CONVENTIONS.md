# CONVENTIONS.md — Security & Coding Standards

Non-negotiable rules for all code in `falcon-harness` and `vulnbank`. Qodo reviews against many of these (see `QODO.md` and `best_practices.md`), so following them here means fewer review cycles. Two audiences read this: Claude Code (follow it) and Qodo (enforces it).

A note on the irony that is also the pitch: this is a security product. Code that ships an obvious vulnerability, leaks a secret, or claims a result it did not measure damages the entire thesis. Hold a higher bar here than on an ordinary hackathon project.

---

## 1. Secrets — the disqualifier rules

1. **Never commit a secret.** No API keys, tokens, passwords, connection strings, `.env` files, Daytona keys, OpenRouter keys, GitHub tokens, or R2 credentials in any commit, ever. This is a hackathon disqualifier (rule 7) and a product-credibility killer.
2. **`.env` is gitignored before the first commit.** Provide `.env.example` with keys named and values blank. Never a real value.
3. **Secrets live in the harness, not in agent code.** TrueForge holds model keys and the GitHub token; the MCP server reads its own credentials from environment variables injected at deploy time (Render env vars). The dashboard holds only the TrueForge API URL, never a model key.
4. **No secret in logs, error messages, or the ledger.** Before logging a request/response, redact `Authorization` header values to `Bearer ***`. The ledger stores the *fact* that a token was present or absent, not the token.
5. **No secret on camera.** Before recording, scrub the terminal and env panels. A leaked key in a demo video is a public leak.
6. **If a secret is ever committed:** rotate it immediately, then remove it from history. Do not just delete the file in a new commit.

---

## 2. Language, runtime, style

- **TypeScript everywhere it is an option.** `vulnbank`, the dashboard, and the MCP server (if Node) are TS. Strict mode on (`"strict": true` in tsconfig). No implicit `any`.
- **Node 22.14+** (TrueForge requires it; keep the toolchain aligned).
- **Python only if a tool genuinely needs it** (e.g. the MCP server if the chosen framework is Python/FastMCP). If Python: type hints on all function signatures, `ruff` clean.
- Formatter/linter: Prettier + ESLint for TS, run before every commit. Keep configs minimal and standard.
- Prefer explicit over clever. This code will be read by judges and by a Qodo reviewer. Optimize for legibility, not brevity.
- No dead code, no commented-out blocks left in. If it is not used, delete it.

---

## 3. Error handling (Qodo flags missing error handling — pre-empt it)

- **Every external call is wrapped and handled**: model calls, sandbox operations, GitHub API, R2, Postgres. No unhandled promise rejections.
- **Fail loud, fail specific.** Throw or return typed errors with a clear message and enough context to debug. Never swallow an error silently.
- **Never let a function "succeed" without doing its job.** This is the core discipline from the winning projects: do not return success because an API returned 200; return success because the thing you claimed actually happened and you checked it. In `verify_ledger`, re-read the bytes. In a probe, confirm the response body actually contains the leaked data before declaring EXPLOITED.
- **Timeouts on everything that can hang**: sandbox boot, probe requests, model calls. A hung agent in a live demo is a lost demo.
- User-facing / PR-comment output: never leak a stack trace or an internal path. Log the detail server-side, show a clean message.

---

## 4. Input handling and the exploitation code specifically

- **`scope_surface` parses untrusted diff text.** Treat the diff as hostile input. Bound the work (cap diff size handled), never `eval` or execute anything from the diff, never interpolate diff content into a shell command or a query.
- **The probe runs in the sandbox, never on the harness host.** Generated probe code executes only inside the Daytona sandbox. Nothing the agent generates runs on our infrastructure directly.
- **The only legal target is `vulnbank`.** The skill and the agent config must make the target explicit. Do not write anything that could point the probe at an arbitrary external host. If a task implies probing something outside the fixture, refuse and flag it.
- **Parameterize every query.** Postgres access uses parameterized statements only. No string-concatenated SQL, even for the ledger, even though the inputs are ours.

---

## 5. The ledger — integrity rules

- Hash function: **SHA-256.** `entry_hash = sha256(canonical_json(entry_without_entry_hash) + prev_hash)`. Genesis `prev_hash = "0" * 64`.
- **Canonical JSON**: keys sorted, stable separators, UTF-8. The same entry must always produce the same hash. Use one shared canonicalization function; never hand-serialize in two places (the Takegraph bug was two "reasonable" hash definitions that could never match — one function, one contract).
- The artifact (request/response blob) is stored content-addressed: key derived from `sha256(bytes)`. `verify_ledger` re-downloads and re-hashes; a mismatch is a broken chain.
- Never mutate a sealed entry. The tamper demo mutates a row *to prove detection*; production code never updates `ledger` rows in place.
- Every seal records: `id, ts, target_repo, pr_number, route, verdict, request(redacted), response, auditor_ok, prev_hash, entry_hash`. Approvals seal too: who approved, which PR, which evidence entry, when.

---

## 6. Commits and PRs

- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`. Scope where useful: `feat(mcp): add scope_surface`.
- **One logical change per PR.** If a PR description needs the word "also", split it.
- **Every PR body has a rationale** for any non-obvious decision (hackathon rule: explain every technical choice).
- Branch names: `pr/<short-description>` for our repo; the vulnbank demo branches are named exactly as in `PROJECT_SPEC.md` §4.
- Do not merge with unresolved High / action-required Qodo findings unless you write the dismissal reason in the Qodo thread. See `QODO.md`.
- `main` must run after every merge.

---

## 7. Dependencies

- Minimal. Every dependency is a thing a judge (and Qodo) can question. Prefer the standard library and small, well-known packages.
- Pin versions. No floating `latest`.
- No package that requires committing a credential to use.
- Before adding a dependency, ask whether TrueForge or the platform already provides it.

---

## 8. Testing and claims

- The `bench` command is the product's own test of its headline claim. It must run all fixture branches, print the verdict matrix, and **exit non-zero if any verdict is wrong.** Treat a failing `bench` as a build breakage.
- Any number stated in the README, video, or write-up must be reproducible by a command in the repo. No asserted metrics.
- Where a capability is not yet real, say so plainly (`UNKNOWN`, "not yet demonstrated end to end"). Honesty about limits reads as confidence and matches the winning-project pattern. Never dress an untested path as a working one.

---

## 9. Documentation

- README is written for a stranger who will clone and run it. Setup steps must actually work from a clean machine.
- The `## Qodo Code Review Evidence` section is mandatory and real (see `QODO.md`).
- Comments explain *why*, not *what*. The code says what.
- Keep `.agent/` docs current: if a decision changes, update the relevant `.agent/*.md` in the same PR.

---

## 10. What good looks like (the standard to hold)

Production-grade means: no secret ever touches version control; every external call handled and timed out; every claim backed by a runnable command; the ledger's integrity provable by re-reading bytes, not by trusting a row; and a Qodo reviewer finding little to flag because the standards above were followed the first time. When in doubt, choose the option that a security auditor reviewing this as a real product would not object to.
