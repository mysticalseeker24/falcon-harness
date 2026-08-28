# Best Practices — falcon-harness

Custom standards Qodo enforces on every PR. Falcon is a security product; a leaked secret, an unhandled failure, or an unverified claim damages the whole thesis, so the bar here is higher than a typical hackathon repo.

## Secrets
- No API keys, tokens, passwords, connection strings, or credentials in any diff. Secrets come from environment variables only.
- `.env` must be gitignored; only `.env.example` (blank values) is committed.

**Before/after:**
```
// Bad
const key = "sk-or-v1-abc123...";
// Good
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is not set");
```

## Error handling on external calls
- Every model, sandbox, GitHub, Postgres, and R2 call is wrapped, handled, and given a timeout. No unhandled promise rejections. No silently swallowed errors.

**Before/after:**
```
// Bad
const res = await fetch(url);
const data = await res.json();
// Good
const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
if (!res.ok) throw new Error(`probe failed: ${res.status}`);
const data = await res.json();
```

## Never claim success without verifying the effect
- Do not treat a 2xx as success. Confirm the intended thing actually happened.
- A finding is EXPLOITED only if a probe returned data it should not have AND a request+response was captured.
- `verify_ledger` re-reads and re-hashes the stored artifact bytes; it never trusts a database row alone.

## Untrusted input (diff text) and the probe
- Diff text is hostile input: never `eval` it, never interpolate it into a shell command or SQL, bound its size.
- Generated probe code runs only inside the Daytona sandbox, never on the harness host.
- The only legal probe target is the `vulnbank` fixture. Never point a probe at any other host.

## SQL
- Parameterized statements only. No string-concatenated queries, even for internal data.

**Before/after:**
```
// Bad
db.query(`INSERT INTO ledger VALUES ('${id}', '${hash}')`);
// Good
db.query("INSERT INTO ledger (id, entry_hash) VALUES ($1, $2)", [id, hash]);
```

## Ledger integrity
- One shared canonical-JSON function; never serialize an entry two different ways (two "reasonable" definitions that never match is a real, silent bug).
- `entry_hash = sha256(canonical_json(entry_without_entry_hash) + prev_hash)`; genesis `prev_hash` is 64 zeros.
- Never mutate a sealed `ledger` row in place in production code.

## Logging and PR output
- Redact `Authorization` header values (`Bearer ***`) before logging, storing, or posting.
- Never leak stack traces, internal paths, or secrets into PR comments or user-facing output.

## Claims
- Any number stated in docs must be reproducible by a command in the repo. No asserted metrics.
- State limitations plainly; do not present an untested path as working.
