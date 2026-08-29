import { promises as fs } from "node:fs";
import path from "node:path";
import { canonicalJson } from "../lib/canonicalJson.js";
import { sha256Hex } from "../lib/hash.js";
import { LedgerEntrySchema, type LedgerEntry } from "../lib/ledger.js";
import type { ArtifactStore, LedgerRow, LedgerStore } from "./types.js";

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

// Append-only JSON-lines ledger on the local filesystem. The tamper demo edits a line here; verify
// re-hashes and catches it. Rows are written through the single canonical serializer and validated
// on read, so malformed or truncated rows surface as corruption rather than exceptions.
export class LocalLedgerStore implements LedgerStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<LedgerRow[]> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if (isErrno(err, "ENOENT")) return [];
      throw err;
    }

    const rows: LedgerRow[] = [];
    let index = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        rows.push({ ok: false, index, reason: "invalid JSON" });
        index += 1;
        continue;
      }
      const result = LedgerEntrySchema.safeParse(parsed);
      if (!result.success) {
        rows.push({ ok: false, index, reason: "schema mismatch" });
      } else {
        rows.push({ ok: true, entry: result.data as LedgerEntry });
      }
      index += 1;
    }
    return rows;
  }

  async append(entry: LedgerEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Persist through the single canonical serializer (CONVENTIONS §5) — never a second stringify.
    await fs.appendFile(this.filePath, `${canonicalJson(entry)}\n`, "utf8");
  }
}

// Content-addressed artifact store: filename === sha256(bytes). Immutable once written.
export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly dir: string) {}

  async put(bytes: Buffer): Promise<string> {
    const key = sha256Hex(bytes);
    await fs.mkdir(this.dir, { recursive: true });
    try {
      await fs.writeFile(path.join(this.dir, key), bytes, { flag: "wx" });
    } catch (err) {
      if (!isErrno(err, "EEXIST")) throw err;
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    // Key comes from the (possibly tampered) ledger; validate its shape before touching the FS so
    // a doctored key can never escape the artifact directory.
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new Error("invalid artifact key");
    }
    return fs.readFile(path.join(this.dir, key));
  }
}
