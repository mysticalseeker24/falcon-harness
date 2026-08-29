import { randomUUID } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import { GENESIS_PREV_HASH, sha256Hex } from "./hash.js";
import { redactRequest } from "./redact.js";
import type { ArtifactStore, LedgerStore } from "../storage/types.js";

export type Verdict = "EXPLOITED" | "CLEAN" | "APPROVAL";

// What a caller (the agent) hands to seal_evidence.
export interface SealInput {
  target_repo: string;
  pr_number: number | null;
  route: string | null;
  verdict: Verdict;
  request: unknown;
  response: unknown;
  auditor_ok: boolean | null;
  approver: string | null;
}

export interface LedgerEntry {
  id: string;
  ts: string;
  target_repo: string;
  pr_number: number | null;
  route: string | null;
  verdict: Verdict;
  request: unknown; // redacted
  response: unknown;
  artifact_key: string | null;
  auditor_ok: boolean | null;
  approver: string | null;
  prev_hash: string;
  entry_hash: string;
}

export interface VerifyResult {
  valid: boolean;
  length: number;
  broken_at: string | null;
}

// The hashing contract (CONVENTIONS §5), in exactly one place:
//   entry_hash = sha256( canonical_json(entry without entry_hash) + prev_hash )
export function computeEntryHash(entry: Omit<LedgerEntry, "entry_hash">): string {
  return sha256Hex(canonicalJson(entry) + entry.prev_hash);
}

// Appends a hash-chained entry. Redacts credentials, stores the request/response artifact
// content-addressed, links to the previous entry, and returns the new entry_hash.
export async function sealEvidence(
  input: SealInput,
  ledger: LedgerStore,
  artifacts: ArtifactStore,
): Promise<{ entry_hash: string }> {
  const request = redactRequest(input.request);

  const artifactBytes = Buffer.from(canonicalJson({ request, response: input.response }), "utf8");
  const artifact_key = await artifacts.put(artifactBytes);

  const entries = await ledger.all();
  const prev_hash = entries.length > 0 ? entries[entries.length - 1].entry_hash : GENESIS_PREV_HASH;

  const unsealed: Omit<LedgerEntry, "entry_hash"> = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    target_repo: input.target_repo,
    pr_number: input.pr_number,
    route: input.route,
    verdict: input.verdict,
    request,
    response: input.response,
    artifact_key,
    auditor_ok: input.auditor_ok,
    approver: input.approver,
    prev_hash,
  };

  const entry_hash = computeEntryHash(unsealed);
  await ledger.append({ ...unsealed, entry_hash });
  return { entry_hash };
}

// Recomputes the chain from genesis AND re-reads + re-hashes each artifact's bytes — trusting the
// stored row is not verification. Returns the id of the first broken entry, or null if intact.
export async function verifyLedger(ledger: LedgerStore, artifacts: ArtifactStore): Promise<VerifyResult> {
  const entries = await ledger.all();
  let prev = GENESIS_PREV_HASH;

  for (const entry of entries) {
    const broken = { valid: false, length: entries.length, broken_at: entry.id } as const;

    // 1. chain link
    if (entry.prev_hash !== prev) return broken;

    // 2. recompute the entry hash from its own contents
    const { entry_hash, ...unsealed } = entry;
    if (computeEntryHash(unsealed) !== entry_hash) return broken;

    // 3. re-read the artifact bytes and re-hash them (do not trust artifact_key)
    if (entry.artifact_key !== null) {
      let bytes: Buffer;
      try {
        bytes = await artifacts.get(entry.artifact_key);
      } catch {
        return broken; // missing or unreadable artifact
      }
      if (sha256Hex(bytes) !== entry.artifact_key) return broken;
    }

    prev = entry.entry_hash;
  }

  return { valid: true, length: entries.length, broken_at: null };
}
