import { createHash } from "node:crypto";

// SHA-256 hex. Used for both the ledger chain and content-addressing artifacts.
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

// Genesis link: 64 zeros.
export const GENESIS_PREV_HASH = "0".repeat(64);
