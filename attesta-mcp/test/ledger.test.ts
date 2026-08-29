import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "../src/lib/canonicalJson.js";
import { GENESIS_PREV_HASH } from "../src/lib/hash.js";
import { sealEvidence, verifyLedger, type SealInput } from "../src/lib/ledger.js";
import { LocalArtifactStore, LocalLedgerStore } from "../src/storage/local.js";

async function freshStores() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "attesta-"));
  const ledgerPath = path.join(dir, "ledger.jsonl");
  const artifactDir = path.join(dir, "artifacts");
  return {
    dir,
    ledgerPath,
    artifactDir,
    ledger: new LocalLedgerStore(ledgerPath),
    artifacts: new LocalArtifactStore(artifactDir),
  };
}

const sample = (verdict: SealInput["verdict"]): SealInput => ({
  target_repo: "DevLab-mgc/vulnbank",
  pr_number: 3,
  route: "/admin/balances",
  verdict,
  request: { method: "GET", path: "/admin/balances", headers: { authorization: "Bearer tenant-a-token" } },
  response: { status: verdict === "EXPLOITED" ? 200 : 401, body: { balances: [] } },
  auditor_ok: true,
  approver: null,
});

const reqHeaders = (req: unknown): Record<string, string> =>
  (req as { headers: Record<string, string> }).headers;

test("canonicalJson is key-order independent and stable", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
});

test("seal redacts Authorization before storing", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const [entry] = await s.ledger.all();
  assert.equal(reqHeaders(entry.request).authorization, "***REDACTED***");
});

test("seal + verify: valid chain, genesis link, chained hashes", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const r2 = await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts);
  const entries = await s.ledger.all();

  assert.equal(entries.length, 2);
  assert.equal(entries[0].prev_hash, GENESIS_PREV_HASH);
  assert.equal(entries[1].prev_hash, entries[0].entry_hash);
  assert.equal(entries[1].entry_hash, r2.entry_hash);

  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), {
    valid: true,
    length: 2,
    broken_at: null,
  });
});

test("tamper: mutating a sealed entry breaks verify at that entry", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts);
  const entries = await s.ledger.all();

  // Flip entry 0's verdict on disk but keep its (now stale) entry_hash.
  const tampered = { ...entries[0], verdict: "CLEAN" };
  await fs.writeFile(s.ledgerPath, `${JSON.stringify(tampered)}\n${JSON.stringify(entries[1])}\n`);

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, entries[0].id);
});

test("tamper: mutating an artifact's bytes breaks verify (re-read discipline)", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const [entry] = await s.ledger.all();
  assert.notEqual(entry.artifact_key, null);

  await fs.writeFile(path.join(s.artifactDir, entry.artifact_key as string), Buffer.from("doctored"));

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, entry.id);
});

test("verify: a missing artifact breaks verify", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const [entry] = await s.ledger.all();

  await fs.rm(path.join(s.artifactDir, entry.artifact_key as string));

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, entry.id);
});

test("empty ledger verifies as valid, length 0", async () => {
  const s = await freshStores();
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), {
    valid: true,
    length: 0,
    broken_at: null,
  });
});
