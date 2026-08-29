import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "../src/lib/canonicalJson.js";
import { GENESIS_PREV_HASH } from "../src/lib/hash.js";
import { computeEntryHash, sealEvidence, verifyLedger, type Auditor, type LedgerEntry, type SealInput } from "../src/lib/ledger.js";
import type { Probe } from "../src/lib/auditor.js";
import { LocalArtifactStore, LocalLedgerStore } from "../src/storage/local.js";

async function freshStores() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "attesta-"));
  const ledgerPath = path.join(dir, "ledger.jsonl");
  const artifactDir = path.join(dir, "artifacts");
  return { dir, ledgerPath, artifactDir, ledger: new LocalLedgerStore(ledgerPath), artifacts: new LocalArtifactStore(artifactDir) };
}
async function entries(store: LocalLedgerStore): Promise<LedgerEntry[]> {
  const rows = await store.read();
  return rows.map((r) => { if (!r.ok) throw new Error(`corrupt row ${r.index}`); return r.entry; });
}

// Mock auditors so seal is tested without a model/network. The real auditor is covered by auditor.test.ts.
const okAuditor: Auditor = async () => ({ auditor_ok: true, reason: "mock ok", checks: [], model: "z-ai/glm-5.3-flash" });
const rejectAuditor: Auditor = async () => ({ auditor_ok: false, reason: "mock reject", checks: [], model: "z-ai/glm-5.3-flash" });

function probe(over: Partial<Probe> = {}): Probe {
  return {
    label: "no-token",
    auth_context: "unauthenticated",
    expected: "deny",
    request: { method: "GET", url: "http://localhost:3000/admin/balances", headers: { authorization: "Bearer tenant-a-token" }, body: null },
    response: { status: 200, headers: {}, body: { balances: [{ id: "acc-a-001", tenantId: "tenant-a", balance: 42000 }] } },
    ...over,
  };
}
const sample = (verdict: "EXPLOITED" | "CLEAN"): SealInput => ({
  target_repo: "DevLab-mgc/vulnbank",
  pr_number: 3,
  route: "/admin/balances",
  verdict,
  probes: verdict === "EXPLOITED" ? [probe()] : [probe({ response: { status: 401, headers: {}, body: { error: "missing Authorization header" } } })],
  approver: null,
});
const asRecord = (v: unknown) => v as Record<string, unknown>;

test("canonicalJson is key-order independent and stable", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
});

test("canonicalJson preserves __proto__ as data (#proto)", () => {
  const withProto = JSON.parse('{"a":1,"__proto__":{"evil":true}}');
  assert.ok(canonicalJson(withProto).includes("__proto__"));
  assert.notEqual(canonicalJson(JSON.parse('{"a":1}')), canonicalJson(withProto));
});

test("seal redacts credentials in the stored primary probe", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, okAuditor);
  const [entry] = await entries(s.ledger);
  assert.equal(asRecord(asRecord(entry.request).headers).authorization, "***REDACTED***");
  assert.equal(entry.auditor_ok, true);
  assert.equal(entry.auditor_model, "z-ai/glm-5.3-flash");
});

test("seal redacts credentials at any depth in the artifact (probe set)", async () => {
  const s = await freshStores();
  const input: SealInput = {
    ...sample("CLEAN"),
    probes: [
      probe({
        response: { status: 401, headers: { "set-cookie": "sess=SECRET1" }, body: { note: "kept" } },
        request: { method: "GET", url: "u", headers: { authorization: "Bearer SECRET2" }, body: { nested: { cookie: "sess=SECRET3" } } },
      }),
    ],
  };
  await sealEvidence(input, s.ledger, s.artifacts, okAuditor);
  const [entry] = await entries(s.ledger);
  const bytes = await s.artifacts.get(entry.artifact_key as string);
  const text = bytes.toString("utf8");
  assert.ok(!text.includes("SECRET1") && !text.includes("SECRET2") && !text.includes("SECRET3"));
});

test("seal refuses to append when the independent audit does not pass (#audit-gate)", async () => {
  const s = await freshStores();
  await assert.rejects(sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, rejectAuditor), /audit did not pass/);
  assert.equal((await s.ledger.read()).length, 0);
});

test("seal + verify: valid chain, genesis link, chained hashes", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, okAuditor);
  const r2 = await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts, okAuditor);
  const es = await entries(s.ledger);
  assert.equal(es.length, 2);
  assert.equal(es[0].prev_hash, GENESIS_PREV_HASH);
  assert.equal(es[1].prev_hash, es[0].entry_hash);
  assert.equal(es[1].entry_hash, r2.entry_hash);
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 2, broken_at: null });
});

test("concurrent seals do not fork the chain", async () => {
  const s = await freshStores();
  await Promise.all(Array.from({ length: 6 }, (_u, i) => sealEvidence({ ...sample("CLEAN"), pr_number: i }, s.ledger, s.artifacts, okAuditor)));
  const es = await entries(s.ledger);
  assert.equal(es.length, 6);
  let prev = GENESIS_PREV_HASH;
  for (const e of es) { assert.equal(e.prev_hash, prev); prev = e.entry_hash; }
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 6, broken_at: null });
});

test("tamper: mutating a sealed entry breaks verify", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, okAuditor);
  await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts, okAuditor);
  const es = await entries(s.ledger);
  await fs.writeFile(s.ledgerPath, `${canonicalJson({ ...es[0], verdict: "CLEAN" })}\n${canonicalJson(es[1])}\n`);
  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, es[0].id);
});

test("tamper: mutating an artifact's bytes breaks verify", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, okAuditor);
  const [entry] = await entries(s.ledger);
  await fs.writeFile(path.join(s.artifactDir, entry.artifact_key as string), Buffer.from("doctored"));
  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, entry.id);
});

test("verify: a missing artifact breaks verify", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, okAuditor);
  const [entry] = await entries(s.ledger);
  await fs.rm(path.join(s.artifactDir, entry.artifact_key as string));
  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
});

test("a malformed ledger row is reported as corruption, not thrown", async () => {
  const s = await freshStores();
  await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts, okAuditor);
  await fs.appendFile(s.ledgerPath, "{ not valid json\n");
  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, "row-1");
});

test("APPROVAL seals who approved which finding (references a prior CLEAN, same repo+PR)", async () => {
  const s = await freshStores();
  const finding = await sealEvidence({ ...sample("CLEAN"), pr_number: 4 }, s.ledger, s.artifacts, okAuditor);
  const appr = await sealEvidence(
    { target_repo: "DevLab-mgc/vulnbank", pr_number: 4, route: "/admin/balances", verdict: "APPROVAL", approver: "alice@example.com", approves_entry_hash: finding.entry_hash },
    s.ledger,
    s.artifacts,
    okAuditor,
  );
  const es = await entries(s.ledger);
  assert.equal(es[1].entry_hash, appr.entry_hash);
  assert.equal(es[1].verdict, "APPROVAL");
  assert.equal(es[1].approves_entry_hash, finding.entry_hash);
  assert.equal(es[1].request, null);
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 2, broken_at: null });
});

test("APPROVAL rejects a non-CLEAN / mismatched / bad-shape reference (#7-referential)", async () => {
  const s = await freshStores();
  const clean = await sealEvidence({ ...sample("CLEAN"), pr_number: 4 }, s.ledger, s.artifacts, okAuditor);
  const expl = await sealEvidence({ ...sample("EXPLOITED"), pr_number: 3 }, s.ledger, s.artifacts, okAuditor);
  const base = { target_repo: "DevLab-mgc/vulnbank", route: null, verdict: "APPROVAL" as const, approver: "x" };
  await assert.rejects(sealEvidence({ ...base, pr_number: 4, approves_entry_hash: "nothex" }, s.ledger, s.artifacts, okAuditor), /hex/);
  await assert.rejects(sealEvidence({ ...base, pr_number: 4, approves_entry_hash: "a".repeat(64) }, s.ledger, s.artifacts, okAuditor), /does not reference/);
  await assert.rejects(sealEvidence({ ...base, pr_number: 3, approves_entry_hash: expl.entry_hash }, s.ledger, s.artifacts, okAuditor), /CLEAN/);
  await assert.rejects(sealEvidence({ ...base, pr_number: 99, approves_entry_hash: clean.entry_hash }, s.ledger, s.artifacts, okAuditor), /must match/);
});

test("legacy rows without the new optional fields still validate/verify/append (#backcompat)", async () => {
  const s = await freshStores();
  const legacy: Omit<LedgerEntry, "entry_hash"> = {
    id: "legacy-1",
    ts: "2026-08-01T00:00:00.000Z",
    target_repo: "DevLab-mgc/vulnbank",
    pr_number: 1,
    route: "/x",
    verdict: "CLEAN",
    request: { method: "GET" },
    response: { status: 401 },
    artifact_key: null,
    auditor_ok: true,
    approver: null,
    prev_hash: GENESIS_PREV_HASH,
  };
  const entry_hash = computeEntryHash(legacy);
  await fs.writeFile(s.ledgerPath, `${JSON.stringify({ ...legacy, entry_hash })}\n`);
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 1, broken_at: null });
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts, okAuditor);
  const es = await entries(s.ledger);
  assert.equal(es[1].prev_hash, entry_hash);
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 2, broken_at: null });
});

test("empty ledger verifies as valid, length 0", async () => {
  const s = await freshStores();
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 0, broken_at: null });
});
