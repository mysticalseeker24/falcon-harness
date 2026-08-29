import type { LedgerEntry } from "../lib/ledger.js";

// A row read back from the ledger: either a validated entry, or a marker that the row at `index`
// (0-based over non-empty rows) was unparseable/invalid, so verify can report corruption instead
// of throwing.
export type LedgerRow = { ok: true; entry: LedgerEntry } | { ok: false; index: number; reason: string };

// Append-only ledger persistence. `read` returns rows in insertion order.
export interface LedgerStore {
  read(): Promise<LedgerRow[]>;
  append(entry: LedgerEntry): Promise<void>;
}

// Content-addressed artifact blob store. `put` returns the content-address key; `get` returns the
// exact bytes (or throws if absent). Verify re-reads and re-hashes these bytes.
export interface ArtifactStore {
  put(bytes: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}
