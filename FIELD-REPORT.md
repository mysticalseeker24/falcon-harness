# Proof, not guesses: building an AI agent that exploits your PR before it merges

*A field report from the TrueForge Agent Harness Hackathon.*

Every security scanner I've ever used tells me the same unsatisfying thing: *"this might be a
problem, severity: medium."* Might. AI coding agents have made that worse — they ship new endpoints
fast, and every so often one forgets an auth check, and the scanner shrugs and assigns it a number.

So for this hackathon I built the opposite of a scanner. It's called **Falcon**, and it doesn't guess.
It reads a pull request, works out the *new* attack surface the change introduced, boots the app in an
isolated sandbox, and runs a **real exploit** against just that surface. It comes back with three
things: a request, a response, and a verdict. Not a severity score — a captured fact.

Here's what that looks like on our deliberately-vulnerable fixture. A PR adds `GET /admin/balances`
and forgets the auth middleware. Falcon sends an unauthenticated request and gets back `200 OK` with
every tenant's account balances. Verdict: **EXPLOITED** — and it blocks the merge, with the exact
request and response attached as proof. Change one line so the route is guarded, and the same probe
gets `401`, then `403`, then `200` for the admin — verdict **CLEAN**, and now Falcon *proposes* the
merge and stops for a human to approve it.

## The one rule that shaped everything

The hackathon's whole premise is a harness — **TrueForge** — that runs the agent loop, dispatches
tools, provisions the sandbox, and pauses for human approval. The central judging criterion is
whether the harness is *actually doing the work*, not being wrapped by a thin app.

That turned into the single most useful design constraint I've had in a while: **do not build the
loop.** Every time I caught myself reaching for an orchestrator, a retry state machine, a step
sequencer — stop, that's TrueForge's job. What was left for me to author was surprisingly small and
surprisingly clean:

- an **MCP server** (three tools: scope the diff, seal the evidence, verify the ledger),
- a **SKILL** file — the playbook the agent follows,
- the **vulnbank** target fixture,
- and a **dashboard** to render the proof.

TrueForge does the rest. Resisting the urge to build more made the architecture better, not worse.
That's the lesson I'll carry out of this: when you're on a good harness, subtraction is design.

## The war stories

The interesting part of any build is where it fights back.

**The harness crashed on my machine before it did anything.** TrueForge threw an ESM path error on
native Windows on the very first run. An hour of confusion later: it doesn't like `C:\`-style paths. I
moved the whole thing into WSL2 and it came to life. (I wrote up the bug as an upstream issue — paying
it forward.)

**One wrong path broke the entire sandbox.** Importing the skill with a slightly-off path didn't just
fail the skill — it made *every* command in the sandbox error out. The failure was total and the
message was cryptic. Fix: the skill path is the *directory*, not the file. Small gotcha, huge blast
radius. It's now the first thing my setup doc warns about.

**The auditor could rubber-stamp itself.** Falcon audits every finding with a *second* model from a
different family before anyone sees it. My first version had the main agent pass an `auditor_ok:
true` flag — which, of course, the main agent could just... always set. A reviewer caught it. The fix
was to move the audit *inside* the sealing step, on the server, where the caller can't forge the
result, and to enforce that the auditor is genuinely a different model family (I compare provider
prefixes at run time). "The writer is never its own verifier" became a load-bearing principle.

**A model that judges beautifully but won't write a line of code.** I used a cheap GLM model as the
auditor and it was great at *judging* evidence. Then I asked it to *generate* a fix snippet and it
returned… empty content. Every time. Turns out it clams up on "reply as strict JSON" code prompts.
Rather than fight it, I pointed the code-suggestion tool at a different model that writes cleanly, and
made the parser tolerant. Different jobs, different models.

**The reviewer caught the bug my fix missed.** This one I'm oddly proud of. Qodo reviewed my deploy
PR and flagged that seeding the ledger wasn't transactional. I fixed it. Qodo re-reviewed and
**re-flagged it**: my fix still wrote the ledger file *before* copying the evidence artifacts it
pointed at — so a crash mid-copy would leave a chain that looks initialized but is actually broken,
and every later boot would accept it. The real fix: copy artifacts first, commit the ledger marker
last with an atomic rename, and add a recovery path. That's a review loop earning its keep.

## Measured, not asserted

Somewhere in the middle I wrote "N flaws caught, 0 false alarms" in the README as a placeholder — and
then made myself a rule: no number ships unless something runnable produces it. So `bench` boots the
real fixture, runs the real pipeline three times per branch, derives each verdict from actual HTTP
responses, and **exits non-zero if any verdict is wrong.** The headline in the README is whatever that
last run printed. A failing `bench` is a build breakage. If you claim a number, back it with a
command.

## Did it actually work?

Yes — end to end, live. Pointed at the real PRs, Falcon provisioned a Daytona sandbox, cloned the
exact commit, installed Node, booted the app, and: on the vulnerable PR, captured the unauthenticated
`200` + cross-tenant balances → **EXPLOITED**, sealed to a hash-chained ledger. On the safe PR,
`401/403/200` → **CLEAN**, proposed the merge, and **paused for my approval**. The ledger re-verifies
by re-reading the bytes; tamper with a row and verification catches it instantly.

## What I'd tell the next builder

Three things. **Let the harness do the work** — the best code I wrote this week is the code I *didn't*
write. **Make your claims provable** — a captured exploit beats a severity score, and a runnable
benchmark beats a sentence. And **keep your critic independent** — if the thing that checks the work
is the same thing that did the work, you don't have a check.

Falcon is diff-scoped exploitation, built on TrueForge, reviewed at every step by Qodo. Proof, not
guesses.

---

*Built with an AI coding assistant under my direction and review — fittingly, since Falcon exists
because AI writes clean-looking code that can be measurably riskier than it reads.*
