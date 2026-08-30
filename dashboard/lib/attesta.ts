import { promises as fs } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { canonicalJson } from "./canonical";
import type { LedgerEntryView, VerifyResult } from "./types";

const LEDGER_PATH = path.resolve(
  process.cwd(),
  /* turbopackIgnore: true */ process.env.ATTESTA_LEDGER_PATH ?? "../attesta-mcp/data/ledger.jsonl",
);
const MCP_URL = process.env.ATTESTA_MCP_URL ?? "http://127.0.0.1:8130/mcp";
// In a split deploy (dashboard on Vercel, attesta-mcp on Render) there is no shared filesystem, so
// entries are read from the backend's read-only /ledger endpoint, and verification from its public
// read-only /verify endpoint — neither needs the write token that gates /mcp.
const LEDGER_URL = process.env.ATTESTA_LEDGER_URL ?? "";
const VERIFY_URL = process.env.ATTESTA_VERIFY_URL ?? "";
const VERIFY_TIMEOUT_MS = 15_000;
const LEDGER_READ_TIMEOUT_MS = 10_000;

// A demo mutation (Tamper/Restore) is destructive, so it is disabled unless the operator explicitly
// opts in AND points the console at a ledger whose name marks it as a throwaway demo copy — never
// canonical evidence. This is enforced server-side; the UI only hides the buttons.
export function demoMutableError(): string | null {
  if (process.env.ATTESTA_DEMO !== "1") {
    return "tamper/restore disabled — set ATTESTA_DEMO=1 to enable the demo (never on a real ledger)";
  }
  if (!/demo/i.test(path.basename(LEDGER_PATH))) {
    return "refusing to mutate a non-demo ledger — point ATTESTA_LEDGER_PATH at a *demo* ledger file";
  }
  return null;
}
export function isDemoMutable(): boolean {
  return demoMutableError() === null;
}

// ---- runtime row validation (a parseable line can still be structurally invalid) -----------------

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

const isStr = (v: unknown): v is string => typeof v === "string";

function toView(parsed: unknown, index: number): LedgerEntryView {
  const corrupt = (): LedgerEntryView => ({
    id: `row-${index}`,
    verdict: "CORRUPT",
    route: null,
    pr_number: null,
    auditor_model: null,
    entry_hash: "—",
    prev_hash: "—",
    ts: "",
  });
  if (parsed === null || typeof parsed !== "object") return corrupt();
  const e = parsed as Record<string, unknown>;
  // The integrity-bearing fields must be strings; anything else is a corrupt row, not a crash.
  if (!isStr(e.id) || !isStr(e.verdict) || !isStr(e.entry_hash) || !isStr(e.prev_hash)) return corrupt();
  return {
    id: e.id,
    verdict: e.verdict,
    route: isStr(e.route) ? e.route : null,
    pr_number: typeof e.pr_number === "number" ? e.pr_number : null,
    auditor_model: isStr(e.auditor_model) ? e.auditor_model : null,
    entry_hash: e.entry_hash,
    prev_hash: e.prev_hash,
    ts: isStr(e.ts) ? e.ts : "",
  };
}

export async function readLedger(): Promise<LedgerEntryView[]> {
  // Split deploy: read entries over HTTP from the backend (which validates + maps them).
  if (LEDGER_URL) return readLedgerRemote();

  let text: string;
  try {
    text = await fs.readFile(LEDGER_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err; // a real I/O error must not masquerade as "no entries"
  }
  const out: LedgerEntryView[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      out.push(toView(null, out.length));
      continue;
    }
    out.push(toView(parsed, out.length));
  }
  return out;
}

async function readLedgerRemote(): Promise<LedgerEntryView[]> {
  const res = await fetch(LEDGER_URL, { cache: "no-store", signal: AbortSignal.timeout(LEDGER_READ_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ledger endpoint HTTP ${res.status}`);
  const data = (await res.json()) as { entries?: unknown };
  if (!Array.isArray(data.entries)) throw new Error("ledger endpoint returned no entries array");
  // Re-validate every row through the same view mapper — never trust the shape off the wire.
  return data.entries.map((e, i) => toView(e, i));
}

// ---- authoritative verification (bounded) --------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Ask attesta-mcp (it recomputes the chain AND re-reads artifact bytes). Bounded end-to-end so a
// hung MCP server surfaces as a verification failure the console can show — never a pending request.
export async function verifyLedger(): Promise<VerifyResult> {
  // Split deploy: verify over the backend's public read-only endpoint (same authoritative check).
  if (VERIFY_URL) {
    const res = await fetch(VERIFY_URL, { cache: "no-store", signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`verify endpoint HTTP ${res.status}`);
    const parsed = (await res.json()) as Partial<VerifyResult>;
    if (typeof parsed.valid !== "boolean" || typeof parsed.length !== "number") {
      throw new Error("verify endpoint returned an unrecognized result shape");
    }
    return { valid: parsed.valid, length: parsed.length, broken_at: parsed.broken_at ?? null };
  }

  const client = new Client({ name: "falcon-dashboard", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  try {
    await withTimeout(client.connect(transport), VERIFY_TIMEOUT_MS, "verify_ledger connect");
    const res = await withTimeout(
      client.callTool({ name: "verify_ledger", arguments: {} }, undefined, { timeout: VERIFY_TIMEOUT_MS }),
      VERIFY_TIMEOUT_MS,
      "verify_ledger call",
    );
    const content = res.content as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as Partial<VerifyResult>;
    if (typeof parsed.valid !== "boolean" || typeof parsed.length !== "number") {
      throw new Error("verify_ledger returned an unrecognized result shape");
    }
    return { valid: parsed.valid, length: parsed.length, broken_at: parsed.broken_at ?? null };
  } finally {
    await client.close().catch(() => {});
  }
}

// ---- demo-only tamper / restore ------------------------------------------------------------------
// Serialized through an in-process lock so the console's own verify/tamper/restore never interleave.
// (Cross-process safety: run the demo against a dedicated demo ledger that attesta is not appending
// to during the demo — enforced by demoMutableError's name check.)

let opChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn);
  opChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface TamperResult {
  tampered: boolean;
  reason?: string;
}

// Back up the ledger (only if no backup exists yet — never clobber the one clean copy), then mutate
// the first entry while keeping its now-stale entry_hash so verify catches the mismatch.
export function tamperLedger(): Promise<TamperResult> {
  return withLock(async () => {
    const gate = demoMutableError();
    if (gate) return { tampered: false, reason: gate };
    const bak = `${LEDGER_PATH}.bak`;
    if (await exists(bak)) {
      return { tampered: false, reason: "already tampered — Restore first (a clean backup already exists)" };
    }
    const text = await fs.readFile(LEDGER_PATH, "utf8");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return { tampered: false, reason: "ledger is empty" };
    let first: Record<string, unknown>;
    try {
      first = JSON.parse(lines[0]) as Record<string, unknown>;
    } catch {
      return { tampered: false, reason: "first ledger row is not valid JSON" };
    }
    await fs.writeFile(bak, text, "utf8"); // create the clean backup before touching the ledger
    first.verdict = first.verdict === "EXPLOITED" ? "CLEAN" : "TAMPERED";
    lines[0] = canonicalJson(first); // persist through the single canonical serializer
    await fs.writeFile(LEDGER_PATH, `${lines.join("\n")}\n`, "utf8");
    return { tampered: true };
  });
}

export interface RestoreResult {
  restored: boolean;
  reason?: string;
}

// Restore from the backup and confirm the bytes match before deleting the backup — a failed restore
// keeps the backup so the clean copy is never lost.
export function restoreLedger(): Promise<RestoreResult> {
  return withLock(async () => {
    const gate = demoMutableError();
    if (gate) return { restored: false, reason: gate };
    const bak = `${LEDGER_PATH}.bak`;
    let backup: string;
    try {
      backup = await fs.readFile(bak, "utf8");
    } catch {
      return { restored: false, reason: "no backup to restore from" };
    }
    await fs.writeFile(LEDGER_PATH, backup, "utf8");
    const now = await fs.readFile(LEDGER_PATH, "utf8");
    if (now !== backup) {
      return { restored: false, reason: "restore verification failed — backup kept" };
    }
    await fs.rm(bak, { force: true });
    return { restored: true };
  });
}
