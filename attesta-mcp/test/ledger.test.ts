import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "../src/lib/canonicalJson.js";
import { GENESIS_PREV_HASH } from "../src/lib/hash.js";
import { sealEvidence, verifyLedger, type LedgerEntry, type SealInput } from "../src/lib/ledger.js";
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

async function entries(store: LocalLedgerStore): Promise<LedgerEntry[]> {
  const rows = await store.read();
  return rows.map((r) => {
    if (!r.ok) throw new Error(`unexpected corrupt row ${r.index}`);
    return r.entry;
  });
}

const sample = (verdict: SealInput["verdict"]): SealInput => ({
  target_repo: "DevLab-mgc/vulnbank",
  pr_number: 3,
  route: "/admin/balances",
  verdict,
  request: { method: "GET", path: "/admin/balances", headers: { authorization: "Bearer tenant-a-token" } },
  response:
    verdict === "EXPLOITED"
      ? { status: 200, body: { balances: [{ id: "acc-a-001", balance: 42000 }] } }
      : { status: 401, body: { error: "missing Authorization header" } },
  auditor_ok: true,
  approver: null,
});

const asRecord = (v: unknown) => v as Record<string, unknown>;

test("canonicalJson is key-order independent and stable", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
});

test("canonicalJson preserves __proto__ as data, so it can't tamper silently (#5)", () => {
  const plain = JSON.parse('{"a":1}');
  const withProto = JSON.parse('{"a":1,"__proto__":{"evil":true}}');
  assert.ok(canonicalJson(withProto).includes("__proto__"));
  assert.notEqual(canonicalJson(plain), canonicalJson(withProto));
});

test("seal redacts Authorization before storing", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const [entry] = await entries(s.ledger);
  assert.equal(asRecord(asRecord(entry.request).headers).authorization, "***REDACTED***");
});

test("redaction covers response headers and nested request bodies (#3)", async () => {
  const s = await freshStores();
  const input: SealInput = {
    ...sample("CLEAN"),
    request: {
      method: "GET",
      path: "/admin/balances",
      headers: { authorization: "Bearer tok" },
      body: { nested: { cookie: "sess=abc" } },
    },
    response: { status: 200, headers: { "set-cookie": "sess=xyz" }, body: { note: "kept" } },
  };
  await sealEvidence(input, s.ledger, s.artifacts);
  const [entry] = await entries(s.ledger);

  const req = asRecord(entry.request);
  const res = asRecord(entry.response);
  assert.equal(asRecord(req.headers).authorization, "***REDACTED***");
  assert.equal(asRecord(asRecord(req.body).nested).cookie, "***REDACTED***");
  assert.equal(asRecord(res.headers)["set-cookie"], "***REDACTED***");
  // and the on-disk artifact must not contain the secrets either
  const bytes = await s.artifacts.get(entry.artifact_key as string);
  const text = bytes.toString("utf8");
  assert.ok(!text.includes("sess=abc") && !text.includes("sess=xyz") && !text.includes("Bearer tok"));
});

test("EXPLOITED requires a 2xx response with a non-empty body (#4)", async () => {
  const s = await freshStores();
  await assert.rejects(
    sealEvidence({ ...sample("EXPLOITED"), verdict: "EXPLOITED", response: { status: 401, body: { e: 1 } } }, s.ledger, s.artifacts),
    /2xx/,
  );
  await assert.rejects(
    sealEvidence({ ...sample("EXPLOITED"), verdict: "EXPLOITED", response: { status: 200, body: {} } }, s.ledger, s.artifacts),
    /non-empty/,
  );
  const ok = await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  assert.match(ok.entry_hash, /^[0-9a-f]{64}$/);
  // the two rejections must not have written any entry
  assert.equal((await entries(s.ledger)).length, 1);
});

test("seal + verify: valid chain, genesis link, chained hashes", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const r2 = await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts);
  const es = await entries(s.ledger);

  assert.equal(es.length, 2);
  assert.equal(es[0].prev_hash, GENESIS_PREV_HASH);
  assert.equal(es[1].prev_hash, es[0].entry_hash);
  assert.equal(es[1].entry_hash, r2.entry_hash);

  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 2, broken_at: null });
});

test("concurrent seals do not fork the chain (#6)", async () => {
  const s = await freshStores();
  await Promise.all(
    Array.from({ length: 6 }, (_unused, i) => sealEvidence({ ...sample("CLEAN"), pr_number: i }, s.ledger, s.artifacts)),
  );
  const es = await entries(s.ledger);
  assert.equal(es.length, 6);
  let prev = GENESIS_PREV_HASH;
  for (const e of es) {
    assert.equal(e.prev_hash, prev);
    prev = e.entry_hash;
  }
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 6, broken_at: null });
});

test("tamper: mutating a sealed entry breaks verify at that entry", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts);
  const es = await entries(s.ledger);

  const tampered = { ...es[0], verdict: "CLEAN" };
  await fs.writeFile(s.ledgerPath, `${canonicalJson(tampered)}\n${canonicalJson(es[1])}\n`);

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, es[0].id);
});

test("tamper: mutating an artifact's bytes breaks verify (re-read discipline)", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const [entry] = await entries(s.ledger);
  await fs.writeFile(path.join(s.artifactDir, entry.artifact_key as string), Buffer.from("doctored"));

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, entry.id);
});

test("verify: a missing artifact breaks verify", async () => {
  const s = await freshStores();
  await sealEvidence(sample("EXPLOITED"), s.ledger, s.artifacts);
  const [entry] = await entries(s.ledger);
  await fs.rm(path.join(s.artifactDir, entry.artifact_key as string));

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, entry.id);
});

test("a malformed ledger row is reported as corruption, not thrown (#7)", async () => {
  const s = await freshStores();
  await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts);
  await fs.appendFile(s.ledgerPath, "{ this is not valid json\n");

  const v = await verifyLedger(s.ledger, s.artifacts);
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, "row-1");
  assert.equal(v.length, 2);
});

test("APPROVAL seals who approved which finding, with no HTTP artifact", async () => {
  const s = await freshStores();
  const finding = await sealEvidence(sample("CLEAN"), s.ledger, s.artifacts);
  const appr = await sealEvidence(
    {
      target_repo: "DevLab-mgc/vulnbank",
      pr_number: 4,
      route: "/admin/balances",
      verdict: "APPROVAL",
      auditor_ok: null,
      approver: "alice@example.com",
      approves_entry_hash: finding.entry_hash,
    },
    s.ledger,
    s.artifacts,
  );
  const es = await entries(s.ledger);
  assert.equal(es.length, 2);
  const a = es[1];
  assert.equal(a.entry_hash, appr.entry_hash);
  assert.equal(a.verdict, "APPROVAL");
  assert.equal(a.approver, "alice@example.com");
  assert.equal(a.approves_entry_hash, finding.entry_hash);
  assert.equal(a.request, null);
  assert.equal(a.response, null);
  assert.equal(a.artifact_key, null);
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 2, broken_at: null });
});

test("APPROVAL requires approver and approves_entry_hash", async () => {
  const s = await freshStores();
  const base = { target_repo: "r", pr_number: 1, route: null, verdict: "APPROVAL" as const, auditor_ok: null };
  await assert.rejects(
    sealEvidence({ ...base, approver: null, approves_entry_hash: "abc" }, s.ledger, s.artifacts),
    /approver/,
  );
  await assert.rejects(
    sealEvidence({ ...base, approver: "x", approves_entry_hash: null }, s.ledger, s.artifacts),
    /approves_entry_hash/,
  );
  assert.equal((await s.ledger.read()).length, 0);
});

test("empty ledger verifies as valid, length 0", async () => {
  const s = await freshStores();
  assert.deepEqual(await verifyLedger(s.ledger, s.artifacts), { valid: true, length: 0, broken_at: null });
});
