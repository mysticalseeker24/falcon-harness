import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonicalJson.js";
import { GENESIS_PREV_HASH, sha256Hex } from "./hash.js";
import { redactDeep } from "./redact.js";
import type { AuditFindingInput, AuditResult, Probe } from "./auditor.js";
import type { ArtifactStore, LedgerStore } from "../storage/types.js";

export type Verdict = "EXPLOITED" | "CLEAN" | "APPROVAL";

export interface SealInput {
  target_repo: string;
  pr_number: number | null;
  route: string | null;
  verdict: Verdict;
  // EXPLOITED/CLEAN: the full set of probes; the server audits these and records them. There is no
  // caller-supplied auditor_ok — the audit runs inside the seal (below), so it cannot be forged.
  probes?: Probe[];
  approver: string | null;
  // For APPROVAL: the entry_hash of the finding a human approved (who approved what).
  approves_entry_hash?: string | null;
}

// The injected independent auditor. seal refuses to append an EXPLOITED/CLEAN entry unless this
// returns auditor_ok, so `auditor_ok` is computed server-side here, never a caller-supplied boolean.
export type Auditor = (input: AuditFindingInput) => Promise<AuditResult>;

export interface LedgerEntry {
  id: string;
  ts: string;
  target_repo: string;
  pr_number: number | null;
  route: string | null;
  verdict: Verdict;
  request: unknown; // redacted primary probe (null for APPROVAL)
  response: unknown; // redacted primary probe (null for APPROVAL)
  artifact_key: string | null; // canonical redacted probe set (null for APPROVAL)
  auditor_ok: boolean | null;
  // Optional so legacy rows written before these fields existed still validate and hash the same
  // (never injected into an entry that did not carry them). New rows always write them.
  auditor_model?: string | null;
  auditor_reason?: string | null;
  approver: string | null;
  approves_entry_hash?: string | null;
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
  // Backward-compatible: absent on legacy rows (accepted, not injected), null/string on new rows.
  auditor_model: z.string().nullable().optional(),
  auditor_reason: z.string().nullable().optional(),
  approver: z.string().nullable(),
  approves_entry_hash: z.string().nullable().optional(),
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

// The decisive probe to surface as the entry's request/response (the "money shot"). For EXPLOITED
// it is the violation (a should-be-denied caller that got data); for CLEAN a rejected deny probe.
function primaryProbe(probes: Probe[], verdict: "EXPLOITED" | "CLEAN"): Probe | undefined {
  if (verdict === "EXPLOITED") {
    return (
      probes.find(
        (p) => p.expected === "deny" && p.response.status >= 200 && p.response.status < 300 && bodyHasData(p.response.body),
      ) ?? probes[0]
    );
  }
  return probes.find((p) => p.expected === "deny") ?? probes[0];
}

// Serialize all seal operations in this process so tip-selection + append is atomic and two
// concurrent seals can never fork the chain (a DB backend would use a transaction / CAS instead).
let sealQueue: Promise<unknown> = Promise.resolve();

export function sealEvidence(
  input: SealInput,
  ledger: LedgerStore,
  artifacts: ArtifactStore,
  auditor: Auditor,
): Promise<{ entry_hash: string }> {
  const run = sealQueue.then(() => doSeal(input, ledger, artifacts, auditor));
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
  auditor: Auditor,
): Promise<{ entry_hash: string }> {
  let request: unknown = null;
  let response: unknown = null;
  let artifact_key: string | null = null;
  let approves_entry_hash: string | null = null;
  let auditor_ok: boolean | null = null;
  let auditor_model: string | null = null;
  let auditor_reason: string | null = null;

  // Read the chain once — used for the tip AND (for APPROVAL) to resolve the referenced finding.
  const rows = await ledger.read();
  const tip = rows.at(-1);
  if (tip && !tip.ok) {
    throw new Error("ledger tail is corrupt; refusing to append");
  }

  if (input.verdict === "APPROVAL") {
    // An approval records who approved which sealed finding — not an HTTP exchange.
    if (!input.approver) throw new Error("APPROVAL requires an approver");
    if (!input.approves_entry_hash || !/^[0-9a-f]{64}$/.test(input.approves_entry_hash)) {
      throw new Error("APPROVAL approves_entry_hash must be a 64-char lowercase hex hash");
    }
    // Resolve the reference: it must identify a prior CLEAN finding for the same repo + PR.
    const approved = rows.find(
      (r): r is Extract<typeof r, { ok: true }> => r.ok && r.entry.entry_hash === input.approves_entry_hash,
    );
    if (!approved) {
      throw new Error("APPROVAL approves_entry_hash does not reference any sealed entry");
    }
    if (approved.entry.verdict !== "CLEAN") {
      throw new Error("APPROVAL must reference a CLEAN finding");
    }
    if (approved.entry.target_repo !== input.target_repo || approved.entry.pr_number !== input.pr_number) {
      throw new Error("APPROVAL repo/PR must match the approved finding");
    }
    approves_entry_hash = input.approves_entry_hash;
  } else {
    const probes = input.probes ?? [];
    if (probes.length === 0) {
      throw new Error(`${input.verdict} requires at least one probe`);
    }
    // AUDIT INSIDE THE SEAL — the gate. The independent auditor (different model family) runs here,
    // so auditor_ok is computed server-side and cannot be a forged caller boolean. If the audit
    // does not pass, we refuse to append (the finding is INCONCLUSIVE for the caller).
    const audit = await auditor({ verdict: input.verdict, route: input.route, probes });
    if (!audit.auditor_ok) {
      throw new Error(`independent audit did not pass: ${audit.reason}`);
    }
    auditor_ok = true;
    auditor_model = audit.model;
    auditor_reason = audit.reason;

    // Redact the ENTIRE probe set (any depth) before hashing or storing.
    const redactedProbes = probes.map((p) => redactDeep(p));
    const primary = primaryProbe(redactedProbes, input.verdict);
    request = primary?.request ?? null;
    response = primary?.response ?? null;
    const artifactBytes = Buffer.from(canonicalJson({ probes: redactedProbes }), "utf8");
    artifact_key = await artifacts.put(artifactBytes);
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
    auditor_ok,
    auditor_model,
    auditor_reason,
    approver: input.approver,
    approves_entry_hash,
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
