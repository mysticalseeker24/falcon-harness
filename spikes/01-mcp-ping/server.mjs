// Spike 01 — custom MCP server registration round-trip. THROWAWAY (delete before PR 2).
// Minimal Streamable-HTTP MCP server exposing ONE tool (`ping`). Goal: prove TrueForge can
// register a custom MCP server by URL and successfully call one of its tools.
//
// Run:   npm install && npm start   (listens on http://localhost:8130/mcp)
// Then register that URL in TrueForge → Settings → Connectors → Add MCP Server.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = process.env.SPIKE_MCP_PORT ? Number(process.env.SPIKE_MCP_PORT) : 8130;

// Build a fresh server per request (stateless Streamable HTTP — simplest thing that can work).
function buildServer() {
  const server = new McpServer({ name: "spike-ping", version: "0.0.1" });

  server.tool(
    "ping",
    "Health-check tool for the MCP-registration spike. Returns pong, echoes an optional message, and stamps the server time so the round-trip is unambiguous.",
    { message: z.string().optional().describe("optional text to echo back") },
    async ({ message }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pong: true,
            echo: message ?? null,
            server_time: new Date().toISOString(),
          }),
        },
      ],
    })
  );

  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Every external/protocol boundary is wrapped — a hung or throwing handler must not 200.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`spike MCP (ping) listening on http://localhost:${PORT}/mcp`);
});
