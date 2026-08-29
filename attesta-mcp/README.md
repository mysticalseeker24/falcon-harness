# attesta-mcp

Falcon's MCP server. Exposes the custom tools the agent uses, over Streamable HTTP (the transport
confirmed in spike 01). Three tools are planned:

| Tool | Status | Purpose |
|---|---|---|
| `scope_surface(diff)` | **implemented** | new HTTP routes a PR introduces + whether each has auth |
| `seal_evidence(finding)` | **implemented** | append a hash-chained entry to the ledger + store the artifact |
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
separate lines is not followed. The diff is treated as untrusted input — size-bounded, never
executed, never interpolated into any sink.

## `seal_evidence(finding) -> { entry_hash }`

Appends a hash-chained entry to the ledger and stores the request/response artifact
content-addressed. `Authorization`/`Cookie`/`x-api-key` header values are redacted before anything
is stored or hashed.

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

## Storage

Behind `LedgerStore` / `ArtifactStore` interfaces (`src/storage`). The **local filesystem backend
is the default and the tested path** — a JSON-lines ledger at `ATTESTA_LEDGER_PATH` and
content-addressed blobs under `ATTESTA_ARTIFACT_DIR` (both under `attesta-mcp/data/`, gitignored).
The deployed demo swaps in Postgres (ledger) + Cloudflare R2 (artifacts) adapters behind the same
interfaces when `DATABASE_URL` / `R2_*` are set (follow-up; not wired yet, so nothing unverified is
presented as working).
