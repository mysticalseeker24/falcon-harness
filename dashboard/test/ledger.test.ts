// Runnable verification for the dashboard's ledger + replay logic (finding: capability claims need a
// test). Covers: canonical serialization agreement with attesta, corrupt-row tolerance on read, and
// the demo tamper/restore state machine (gate, backup-once, stale-hash mutation, verified restore).
//
//   npm test    →  node --import tsx --test test/*.test.ts
//
// lib/attesta reads its ledger path + demo flag at import time, so we set them and import it inside a
// before() hook (the package is CommonJS, so no top-level await).
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "../lib/canonical";

let attesta: typeof import("../lib/attesta");
let work: string;
let LEDGER: string;

const validRow = {
  id: "e1",
  verdict: "EXPLOITED",
  route: "/admin/balances",
  pr_number: 3,
  auditor_model: "z-ai/glm-5.3-flash",
  entry_hash: "aaaabbbbccccdddd",
  prev_hash: "0000000000000000",
  ts: "2026-08-30T00:00:00.000Z",
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
async function writeLedger(lines: string[]) {
  await fs.writeFile(LEDGER, lines.join("\n") + "\n", "utf8");
}

before(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), "falcon-dash-test-"));
  LEDGER = path.join(work, "demo-ledger.jsonl"); // "demo" in the name → demoMutableError allows it
  process.env.ATTESTA_DEMO = "1";
  process.env.ATTESTA_LEDGER_PATH = LEDGER;
  attesta = await import("../lib/attesta");
});

test("canonicalJson sorts keys and keeps __proto__ as data (matches attesta serializer)", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ z: [{ y: 1, x: 2 }] }), '{"z":[{"x":2,"y":1}]}');
  const withProto = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
  assert.match(canonicalJson(withProto), /"__proto__":/); // represented as data, not the prototype
});

test("readLedger tolerates corrupt rows instead of throwing", async () => {
  await writeLedger([
    JSON.stringify(validRow),
    "this is not json",
    JSON.stringify({ id: 123, verdict: 7 }), // parseable but structurally invalid
  ]);
  const entries = await attesta.readLedger();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].verdict, "EXPLOITED");
  assert.equal(entries[1].verdict, "CORRUPT");
  assert.equal(entries[2].verdict, "CORRUPT");
  for (const e of entries) assert.equal(typeof e.entry_hash, "string"); // safe to .slice() in the UI
});

test("tamper backs up once, keeps the stale hash; restore reverts and clears the backup", async () => {
  await writeLedger([JSON.stringify(validRow)]);

  const t1 = await attesta.tamperLedger();
  assert.equal(t1.tampered, true);
  const after = await attesta.readLedger();
  assert.notEqual(after[0].verdict, "EXPLOITED"); // fact flipped
  assert.equal(after[0].entry_hash, validRow.entry_hash); // hash left stale so verify catches it
  assert.equal(await exists(`${LEDGER}.bak`), true);

  const t2 = await attesta.tamperLedger(); // must not clobber the one clean backup
  assert.equal(t2.tampered, false);
  assert.match(t2.reason ?? "", /already tampered/i);

  const r1 = await attesta.restoreLedger();
  assert.equal(r1.restored, true);
  const restored = await attesta.readLedger();
  assert.equal(restored[0].verdict, "EXPLOITED");
  assert.equal(await exists(`${LEDGER}.bak`), false);

  const r2 = await attesta.restoreLedger(); // nothing to restore now
  assert.equal(r2.restored, false);
});

test("tamper/restore refuse when demo mode is off", async () => {
  process.env.ATTESTA_DEMO = "0";
  const t = await attesta.tamperLedger();
  assert.equal(t.tampered, false);
  assert.match(t.reason ?? "", /ATTESTA_DEMO/);
  process.env.ATTESTA_DEMO = "1";
});

test("cleanup", async () => {
  await fs.rm(work, { recursive: true, force: true });
});
