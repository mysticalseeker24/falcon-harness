import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // attesta-mcp's ledger path + MCP url are read server-side (see lib/attesta.ts).
  reactStrictMode: true,
  // The MCP client is a Node library — keep it external rather than bundling it into the route.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
};

export default nextConfig;
