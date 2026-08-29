import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../lib/hash.js";
import type { LedgerEntry } from "../lib/ledger.js";
import type { ArtifactStore, LedgerStore } from "./types.js";

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

// Append-only JSON-lines ledger on the local filesystem. The tamper demo edits a line here; verify
// re-hashes and catches it.
export class LocalLedgerStore implements LedgerStore {
  constructor(private readonly filePath: string) {}

  async all(): Promise<LedgerEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if (isErrno(err, "ENOENT")) return [];
      throw err;
    }
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as LedgerEntry);
  }

  async append(entry: LedgerEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
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
      // Identical content already stored — same key, same bytes. Anything else is a real error.
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
