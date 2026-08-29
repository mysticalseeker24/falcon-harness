# Spike 01 — custom MCP server registers + round-trips

**Unknown (PROJECT_SPEC §10.3 / TOOLS.md §2):** can a custom MCP server we host register in
TrueForge and get one tool call successfully round-tripped? Confirm this with a trivial tool
before writing the real three (`scope_surface`, `seal_evidence`, `verify_ledger`).

## Run

```bash
cd spikes/01-mcp-ping
npm install
npm start
# -> spike MCP (ping) listening on http://localhost:8130/mcp
```

Local sanity check (optional), in another terminal:

```bash
curl -s http://localhost:8130/health   # -> {"ok":true}
```

## Register in TrueForge

1. TrueForge running locally (`npx @truefoundry/trueforge`, http://localhost:8790).
2. **Settings → Connectors → Add MCP Server.**
3. URL: `http://localhost:8130/mcp`. Auth: none (local spike).
4. Save. The `ping` tool should appear in the server's tool list.

## Confirm the round-trip

In the TrueForge chat, ask the agent:

> Call the `ping` tool with message `"falcon-spike"` and show me the raw result.

**PASS** if the agent returns a payload containing `"pong": true`, `"echo": "falcon-spike"`, and a
`server_time`. That proves registration + discovery + invocation + response all work end to end.

## If it fails — fallback

TrueForge registers by URL, so it expects HTTP. If Streamable HTTP does not register or call
cleanly, match the transport TrueForge's own custom-MCP example uses (TOOLS.md §2 says confirm
SSE/HTTP vs stdio and match it):

- **SSE:** swap `StreamableHTTPServerTransport` for `SSEServerTransport`
  (`@modelcontextprotocol/sdk/server/sse.js`) with a `GET /sse` + `POST /messages` pair.
- **stdio:** co-locate the server and register it as a stdio command instead of a URL.

Record which transport worked in the repo-root **Spike results** table.
