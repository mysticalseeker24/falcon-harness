# attesta-mcp

Falcon's MCP server. Exposes the custom tools the agent uses, over Streamable HTTP (the transport
confirmed in spike 01). Three tools are planned:

| Tool | Status | Purpose |
|---|---|---|
| `scope_surface(diff)` | **implemented** | new HTTP routes a PR introduces + whether each has auth |
| `seal_evidence(finding)` | **implemented** | independently audit (different model family) then append a hash-chained entry + store the artifact |
| `verify_ledger()` | **implemented** | recompute the chain and re-read artifact bytes |

## Run

```bash
npm install
npm start          # attesta-mcp on http://localhost:8130/mcp
npm test           # unit tests (node:test via tsx)
npm run typecheck  # tsc --noEmit
```

The server binds **loopback (`127.0.0.1`) by default** — it is an unauthenticated local dev server.
Override `ATTESTA_MCP_HOST` only for a deployment that also adds auth + network controls.

Register in TrueForge: Settings → Connectors → Add MCP Server → `http://localhost:8130/mcp`.

## `scope_surface(diff) -> { routes: [...] }`

Reads the **added** lines of a unified diff and returns the new Express route registrations:

```jsonc
{
  "routes": [
    { "method": "GET", "path": "/admin/balances", "handler": "inline",
      "auth_present": false, "source_line": 21 }
  ]
}
```

- `auth_present` is `true` only when a known auth-middleware identifier (`authMiddleware`,
  `requireAdmin`, `requireAuth`, …) appears in the **middleware arguments** — before the handler
  function, with comments and string contents stripped so they can't masquerade as middleware.
- `source_line` is the line in the new file.

**Honest scope (by design, stated plainly):** regex-based, no AST. It detects
`<router>.<method>("/path", …)` when the registration **begins the added line** (an executable
position, not inside a comment or string) with method + path on that line; middleware split across
separate lines is not followed. It reports routes **added** by the diff and the auth on each added
line — it does **not** compare against removed lines or prior middleware, so on its own it does not
detect auth *weakened or removed* from a pre-existing route (e.g. a route whose middleware changed
across multiple lines). `SKILL.md` treats any such case as **INCONCLUSIVE** and flags it for human
review rather than assuming it is safe. The diff is treated as untrusted input — size-bounded, never
executed, never interpolated into any sink.

## `seal_evidence(finding) -> { entry_hash }`

Appends a hash-chained entry to the ledger.
- **EXPLOITED / CLEAN** — pass the full **`probes`** set (each a complete HTTP exchange + `auth_context`
  + `expected` deny/allow). The server **independently audits the probes on a different model family
  first (see below) and refuses to seal unless the audit passes** — there is no caller-supplied
  `auditor_ok`, so it can't be forged. Credentials are redacted (any depth) before anything is hashed
  or stored; the redacted probe set is the content-addressed artifact, and the decisive probe is
  stored as the entry's request/response.
- **APPROVAL** — pass `approver` + `approves_entry_hash` (the `entry_hash` of the finding a human
  approved). No probes; records who approved which finding, and when — the approval itself is sealed
  into the same tamper-evident chain.

Hashing contract (one function, `lib/canonicalJson.ts` + `lib/hash.ts`):

```
entry_hash = sha256( canonical_json(entry without entry_hash) + prev_hash )
genesis prev_hash = "0" * 64
artifact_key       = sha256(artifact bytes)   # content-addressed
```

## `verify_ledger() -> { valid, length, broken_at }`

Recomputes the chain from genesis **and re-reads + re-hashes each artifact's bytes** — it never
trusts the stored row. `broken_at` is the id of the first tampered entry (or `null`). A mutated
ledger row, a mutated artifact, or a missing artifact all fail verification.

## The independent audit (inside `seal_evidence`)

"The writer is never its own verifier." `seal_evidence` audits before it appends. Two layers, in the
style of a structured code reviewer (rubric-driven, evidence-linked pass/fail checks):

1. **Deterministic checks** (no model, cheap): objective consistency between the probes and the
   verdict — every probe is a complete exchange; **EXPLOITED** ⟹ a should-be-denied caller received a
   2xx with protected data (forbidden data, not merely non-empty); **CLEAN** ⟹ coverage (≥1 deny
   probe) + every deny probe rejected (401/403) + no violations. If these fail, the model is never
   called and the audit fails.
2. **One call to a DIFFERENT model family** — `AUDITOR_MODEL` (default `z-ai/glm-5.3-flash`; cheap and
   a genuinely different family from the writer, `WRITER_MODEL`, default DeepSeek). **Independence is
   enforced**, not assumed: if the auditor and writer resolve to the same provider family, the audit
   fails. Evidence is redacted before it reaches the model and treated as untrusted (the model can
   only *veto*, never approve on its own — so a hostile response body can't force approval).

The audit passes only if **both** layers agree. It **fails closed**: missing `OPENROUTER_API_KEY`,
same family, a model error, or a malformed/contradictory model reply all cause the seal to be refused
(never a rubber stamp), and upstream error text is never surfaced. Needs `OPENROUTER_API_KEY` and
(optionally) `AUDITOR_MODEL` / `WRITER_MODEL` in attesta-mcp's env.

## Storage

Behind `LedgerStore` / `ArtifactStore` interfaces (`src/storage`). The **local filesystem backend
is the default and the tested path** — a JSON-lines ledger at `ATTESTA_LEDGER_PATH` and
content-addressed blobs under `ATTESTA_ARTIFACT_DIR` (both under `attesta-mcp/data/`, gitignored).
The deployed demo swaps in Postgres (ledger) + Cloudflare R2 (artifacts) adapters behind the same
interfaces when `DATABASE_URL` / `R2_*` are set (follow-up; not wired yet, so nothing unverified is
presented as working).
