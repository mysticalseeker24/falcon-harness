# attesta-mcp

Falcon's MCP server. Exposes the custom tools the agent uses, over Streamable HTTP (the transport
confirmed in spike 01). Three tools are planned:

| Tool | Status | Purpose |
|---|---|---|
| `scope_surface(diff)` | **implemented** | new HTTP routes a PR introduces + whether each has auth |
| `seal_evidence(finding)` | planned | append a hash-chained entry to the ledger + store the artifact |
| `verify_ledger()` | planned | recompute the chain and re-read artifact bytes |

## Run

```bash
npm install
npm start          # attesta-mcp on http://localhost:8130/mcp
npm test           # unit tests (node:test via tsx)
npm run typecheck  # tsc --noEmit
```

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

- `auth_present` is `true` when a known auth-middleware identifier (`authMiddleware`, `requireAdmin`,
  `requireAuth`, …) appears in the handler chain on the route's line.
- `source_line` is the line in the new file.

**Honest scope (by design, stated plainly):** regex-based, no AST. It detects
`<router>.<method>("/path", …)` when the method + path are on one added line, and reads auth
identifiers from that same line; middleware split across separate lines is not followed. The diff
is treated as untrusted input — size-bounded, never executed, never interpolated into any sink.
