import type { LedgerEntry } from "../lib/ledger.js";

// Append-only ledger persistence. Implementations must return entries in insertion order.
export interface LedgerStore {
  all(): Promise<LedgerEntry[]>;
  append(entry: LedgerEntry): Promise<void>;
}

// Content-addressed artifact blob store. `put` returns the content-address key; `get` returns the
// exact bytes (or throws if absent). Verify re-reads and re-hashes these bytes.
export interface ArtifactStore {
  put(bytes: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}
