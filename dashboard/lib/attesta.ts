import { promises as fs } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LedgerEntryView, VerifyResult } from "./types";

const LEDGER_PATH = path.resolve(
  process.cwd(),
  /* turbopackIgnore: true */ process.env.ATTESTA_LEDGER_PATH ?? "../attesta-mcp/data/ledger.jsonl",
);
const MCP_URL = process.env.ATTESTA_MCP_URL ?? "http://127.0.0.1:8130/mcp";

interface RawEntry {
  id: string;
  verdict: string;
  route: string | null;
  pr_number: number | null;
  auditor_model?: string | null;
  entry_hash: string;
  prev_hash: string;
  ts: string;
}

export async function readLedger(): Promise<LedgerEntryView[]> {
  let text: string;
  try {
    text = await fs.readFile(LEDGER_PATH, "utf8");
  } catch {
    return [];
  }
  const out: LedgerEntryView[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as RawEntry;
      out.push({
        id: e.id,
        verdict: e.verdict,
        route: e.route ?? null,
        pr_number: e.pr_number ?? null,
        auditor_model: e.auditor_model ?? null,
        entry_hash: e.entry_hash,
        prev_hash: e.prev_hash,
        ts: e.ts,
      });
    } catch {
      out.push({ id: `row-${out.length}`, verdict: "CORRUPT", route: null, pr_number: null, auditor_model: null, entry_hash: "—", prev_hash: "—", ts: "" });
    }
  }
  return out;
}

// Authoritative verification: ask attesta-mcp (it recomputes the chain AND re-reads artifact bytes).
export async function verifyLedger(): Promise<VerifyResult> {
  const client = new Client({ name: "falcon-dashboard", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  try {
    await client.connect(transport);
    const res = await client.callTool({ name: "verify_ledger", arguments: {} });
    const content = res.content as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    return JSON.parse(text) as VerifyResult;
  } finally {
    await client.close().catch(() => {});
  }
}

// Demo-only, reversible tamper: back up the ledger, then mutate the first entry (keeping its stale
// hash) so verify catches it. `restore` reverts from the backup.
export async function tamperLedger(): Promise<{ tampered: boolean }> {
  const text = await fs.readFile(LEDGER_PATH, "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { tampered: false };
  await fs.writeFile(`${LEDGER_PATH}.bak`, text, "utf8");
  const first = JSON.parse(lines[0]) as RawEntry & Record<string, unknown>;
  // Flip a recorded fact but keep the (now stale) entry_hash — verify must detect the mismatch.
  first.verdict = first.verdict === "EXPLOITED" ? "CLEAN" : "TAMPERED";
  lines[0] = JSON.stringify(first);
  await fs.writeFile(LEDGER_PATH, `${lines.join("\n")}\n`, "utf8");
  return { tampered: true };
}

export async function restoreLedger(): Promise<{ restored: boolean }> {
  try {
    const bak = await fs.readFile(`${LEDGER_PATH}.bak`, "utf8");
    await fs.writeFile(LEDGER_PATH, bak, "utf8");
    await fs.rm(`${LEDGER_PATH}.bak`);
    return { restored: true };
  } catch {
    return { restored: false };
  }
}
