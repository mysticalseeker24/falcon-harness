import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonicalJson.js";
import { GENESIS_PREV_HASH, sha256Hex } from "./hash.js";
import { redactDeep } from "./redact.js";
import type { ArtifactStore, LedgerStore } from "../storage/types.js";

export type Verdict = "EXPLOITED" | "CLEAN" | "APPROVAL";

// A captured HTTP exchange. Structured so seal_evidence can verify a verdict against real evidence
// instead of rubber-stamping a caller-supplied string.
export interface EvidenceRequest {
  method: string;
  path?: string;
  url?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}
export interface EvidenceResponse {
  status: number;
  headers?: Record<string, unknown>;
  body?: unknown;
}

export interface SealInput {
  target_repo: string;
  pr_number: number | null;
  route: string | null;
  verdict: Verdict;
  request: EvidenceRequest;
  response: EvidenceResponse;
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
  request: unknown; // redacted evidence
  response: unknown; // redacted evidence
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

// Structural schema enforced at the storage boundary (see LocalLedgerStore.read). Guards the
// integrity-bearing fields; request/response stay opaque (their integrity is covered by the hash).
export const LedgerEntrySchema = z.object({
  id: z.string().min(1),
  ts: z.string().min(1),
  target_repo: z.string(),
  pr_number: z.number().int().nullable(),
  route: z.string().nullable(),
  verdict: z.enum(["EXPLOITED", "CLEAN", "APPROVAL"]),
  request: z.unknown(),
  response: z.unknown(),
  artifact_key: z.string().nullable(),
  auditor_ok: z.boolean().nullable(),
  approver: z.string().nullable(),
  prev_hash: z.string().length(64),
  entry_hash: z.string().length(64),
});

// The hashing contract (CONVENTIONS §5), in exactly one place:
//   entry_hash = sha256( canonical_json(entry without entry_hash) + prev_hash )
export function computeEntryHash(entry: Omit<LedgerEntry, "entry_hash">): string {
  return sha256Hex(canonicalJson(entry) + entry.prev_hash);
}

function bodyHasData(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === "string") return body.trim().length > 0;
  if (Array.isArray(body)) return body.length > 0;
  if (typeof body === "object") return Object.keys(body).length > 0;
  return true; // number / boolean
}

// An EXPLOITED verdict may only be sealed with a complete exchange that actually returned data:
// a 2xx response with a non-empty body. This is the "never claim success without checking" rule
// enforced at the seal boundary (CONVENTIONS §3), not just in the SKILL prose.
function assertVerdictEvidence(verdict: Verdict, response: EvidenceResponse): void {
  if (verdict !== "EXPLOITED") return;
  if (response.status < 200 || response.status >= 300) {
    throw new Error("EXPLOITED requires a 2xx response (the probe must have returned data)");
  }
  if (!bodyHasData(response.body)) {
    throw new Error("EXPLOITED requires a non-empty response body (data that should not have been returned)");
  }
}

// Serialize all seal operations in this process so tip-selection + append is atomic and two
// concurrent seals can never fork the chain (a DB backend would use a transaction / CAS instead).
let sealQueue: Promise<unknown> = Promise.resolve();

export function sealEvidence(
  input: SealInput,
  ledger: LedgerStore,
  artifacts: ArtifactStore,
): Promise<{ entry_hash: string }> {
  const run = sealQueue.then(() => doSeal(input, ledger, artifacts));
  sealQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doSeal(
  input: SealInput,
  ledger: LedgerStore,
  artifacts: ArtifactStore,
): Promise<{ entry_hash: string }> {
  assertVerdictEvidence(input.verdict, input.response);

  // Redact the ENTIRE evidence (request + response, any depth) before hashing or storing.
  const request = redactDeep(input.request);
  const response = redactDeep(input.response);

  const artifactBytes = Buffer.from(canonicalJson({ request, response }), "utf8");
  const artifact_key = await artifacts.put(artifactBytes);

  const rows = await ledger.read();
  const tip = rows.at(-1);
  if (tip && !tip.ok) {
    throw new Error("ledger tail is corrupt; refusing to append");
  }
  const prev_hash = tip ? tip.entry.entry_hash : GENESIS_PREV_HASH;

  const unsealed: Omit<LedgerEntry, "entry_hash"> = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    target_repo: input.target_repo,
    pr_number: input.pr_number,
    route: input.route,
    verdict: input.verdict,
    request,
    response,
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
// stored row is not verification. A malformed/invalid row is reported as corruption rather than
// thrown. Returns the id of the first broken entry (or `row-<index>` for an unparseable row), or
// null if intact.
export async function verifyLedger(ledger: LedgerStore, artifacts: ArtifactStore): Promise<VerifyResult> {
  const rows = await ledger.read();
  let prev = GENESIS_PREV_HASH;

  for (const row of rows) {
    if (!row.ok) {
      return { valid: false, length: rows.length, broken_at: `row-${row.index}` };
    }
    const entry = row.entry;
    const broken = { valid: false, length: rows.length, broken_at: entry.id } as const;

    if (entry.prev_hash !== prev) return broken;

    const { entry_hash, ...unsealed } = entry;
    if (computeEntryHash(unsealed) !== entry_hash) return broken;

    if (entry.artifact_key !== null) {
      let bytes: Buffer;
      try {
        bytes = await artifacts.get(entry.artifact_key);
      } catch {
        return broken;
      }
      if (sha256Hex(bytes) !== entry.artifact_key) return broken;
    }

    prev = entry.entry_hash;
  }

  return { valid: true, length: rows.length, broken_at: null };
}
