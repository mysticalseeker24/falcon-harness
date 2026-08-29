# QODO.md — The Qodo Review Gate

How Qodo reviews `falcon-harness`, what setup it needs, and what a clean PR looks like. This is the Q Branch track evidence engine and a **mandatory** part of a valid submission — every substantive change must go through a Qodo-reviewed PR. It is also delicate: a Qodo person scores you.

---

## 1. What Qodo is here

Qodo Merge (the managed GitHub App) is an AI code reviewer. On each PR it runs commands (describe, review, and optionally compliance) and posts findings. Three config surfaces matter, and they do different jobs (not redundant):

- **`REVIEW.md`** in the repo root — repository-specific review instructions. Qodo reads it automatically and uses it to calibrate severity, focus the review, and reduce noise. This is the primary review-customization surface. Claude Code's own Code Review reads the same file, so it serves both tools. It is provided in this repo (root).
- **`.pr_agent.toml`** in the repo root — controls reviewer *behavior* (which commands auto-run, inline comments, suggestion count). Provider-specific section required.
- **`best_practices.md`** in the repo root — custom standards for the `/improve` tool; Qodo flags PR code that violates them under an "Organization best practices" label. Think of it as "what good code looks like, generate suggestions," where `REVIEW.md` is "how to calibrate the review."
- (Optional) **`pr_compliance_checklist.yaml`** — custom compliance checks for the `/compliance` tool. Skip for the hackathon unless you have spare time; a nice-to-have, not required.

`REVIEW.md`, `.pr_agent.toml`, and `best_practices.md` are all provided in this repo (root). Keep `.pr_agent.toml` **minimal** — only the settings we actually use. Copying the full default config is a documented anti-pattern (defaults drift and break you). Note: `vulnbank` has its own short `REVIEW.md` telling the reviewer its vulnerabilities are intentional. **Observed behavior (2026-08-29):** this instruction is advisory — in *Balanced* mode Qodo read `REVIEW.md` and acknowledged the intent in its summary, but still reported the planted broken-access-control flaw as a **High** finding on the vuln PR. So expect the fixture's `pr/*-vuln` PR to carry a Qodo High; it is cosmetic (those PRs are demo input Falcon scans, never merged) and on-narrative — it shows static review catches this class too, while Qodo correctly cleared the look-alike `pr/*-safe` PR. Do not lean on "Qodo can't find it" in the pitch; lean on Falcon returning a **proven** exploit (the captured no-token 200 + data) and the zero-false-alarm on the safe branch.

---

## 2. One-time setup (do before PR 0 is opened)

You said the GitHub App is installed and Qodo is set up in VS Code. Confirm this specific state:

1. **Qodo Merge GitHub App is installed on `mysticalseeker24/falcon-harness`** (not only the VS Code extension). The App is what reviews PRs; the extension is for local/IDE. Check github.com/settings/installations → Qodo → repository access includes falcon-harness.
2. **`.pr_agent.toml` and `best_practices.md` are committed to the root of the default branch (`main`).** Qodo config takes effect only after it is on the default branch. So PR 0 (docs + config) must merge before later PRs get the customized review. The very first PR may get a default review; that is fine.
3. Confirm which auto-commands run on PR open. Our `.pr_agent.toml` sets the GitHub App to run describe + review automatically. If Qodo's account defaults changed to compliance-as-default, that is fine too.
4. You can also invoke Qodo manually in any PR by commenting a slash command (e.g. `/review`, `/improve`, `/describe`). Use `/review` to force a fresh pass after pushing fixes.

If the App is NOT installed on the repo, install it now: qodo.ai → Qodo Merge → GitHub App → grant access to the repo. Without the App on the repo, there is no Q Branch trail and the submission is invalid on that track.

---

## 3. The PR loop (every PR, no exceptions)

1. Branch off `main` (`pr/<description>`).
2. Make one logical change. Follow `CONVENTIONS.md` so Qodo has little to flag.
3. Open the PR with a descriptive body + rationale.
4. Qodo reviews automatically. Read every finding.
5. **Resolve High / action-required findings**: fix them, push, re-review (`/review`).
6. **If you dismiss a finding, write why in the Qodo thread** — a one-line reason. Judges are told to check whether Qodo was genuinely part of the build; a thoughtful dismissal reason is evidence it was. A silent ignore is not.
7. Merge only when High findings are resolved or reasoned-away and `main` will still run.

Do not batch. A dense trail of ~10 small, genuinely-resolved PRs over the day is the deliverable. One giant PR at the end fails the track even if the code is good.

---

## 4. The Qodo narrative (handle with care — a Qodo person scores you)

- Frame Qodo and Falcon as **complementary layers, never replacement.** Qodo reviewed the code Falcon is written in; Falcon exploit-tested the kind of code Qodo reviews. Static review catches one class of issue, execution catches another. They sit on top of each other.
- **Do NOT put the F1 50.3% benchmark stat anywhere** — not the repo, not the README, not the video, not the write-up. It reads as antagonistic to the reviewer's own product. This is the single most important don't.
- Never disparage Qodo or position Falcon as "better than" static review. Different layers, both needed.

---

## 5. The `## Qodo Code Review Evidence` README section (mandatory)

Build this section as you go; finalize in PR 10. It must contain:
- A link to at least one representative **merged** PR where Qodo reviewed real code.
- 1–2 sentences on what Qodo surfaced and what you changed (or dismissed, with reason).
- A **follow-up review against the final code** (run `/review` on a late PR so there is a recent pass on near-final code), showing the reviewer engaged with the finished product, not just early scaffolding.

This section is both a rule-10 requirement and the clearest signal to the Q Branch judge that the review was part of the build.

---

## 6. What our `.pr_agent.toml` does (already in repo root)

- Sets the **GitHub App** provider section with `pr_commands` running describe + review on PR open. (Only ONE provider section may exist in the file — GitHub App only. Do not add gitlab/bitbucket sections.)
- Focuses the reviewer on security, logic errors, and missing error handling; tells it not to nitpick style (Prettier/ESLint handle that).
- Sets a sensible inline-comment severity threshold so the trail shows real findings, not noise.

Keep it minimal. If a setting is not doing work, remove it.

---

## 7. What our `best_practices.md` does (already in repo root)

Encodes the security-critical subset of `CONVENTIONS.md` in the format Qodo expects (clear, concise, with brief before/after examples). It makes Qodo enforce our own standards — secrets handling, error handling on external calls, the "never claim success without checking" rule, parameterized queries, the ledger canonical-hash contract. This turns Qodo into a second pair of eyes on exactly the things that would damage a security product if they slipped.
