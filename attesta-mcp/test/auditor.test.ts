import { test } from "node:test";
import assert from "node:assert/strict";
import { auditFinding, deterministicChecks, type AuditFindingInput } from "../src/lib/auditor.js";
import type { ModelCall } from "../src/lib/openrouter.js";

const exploited: AuditFindingInput = {
  verdict: "EXPLOITED",
  route: "/admin/balances",
  request: { method: "GET", url: "http://localhost:3000/admin/balances", headers: {}, body: null },
  response: { status: 200, body: { balances: [{ id: "acc-a-001", balance: 42000 }] } },
};
const clean: AuditFindingInput = {
  verdict: "CLEAN",
  route: "/admin/balances",
  request: { method: "GET", url: "http://localhost:3000/admin/balances" },
  response: { status: 401, body: { error: "missing Authorization header" } },
};

const okModel: ModelCall = async () => JSON.stringify({ ok: true, reason: "confirmed", checks: [] });
const rejectModel: ModelCall = async () => JSON.stringify({ ok: false, reason: "not convinced", checks: [] });
const fencedModel: ModelCall = async () => '```json\n{"ok": true, "reason": "confirmed via fence", "checks": []}\n```';
const throwModel: ModelCall = async () => { throw new Error("HTTP 500"); };

test("deterministic checks: EXPLOITED needs 2xx + data", () => {
  assert.ok(deterministicChecks(exploited).every((c) => c.pass));
  assert.ok(deterministicChecks({ ...exploited, response: { status: 401, body: { e: 1 } } }).some((c) => !c.pass));
  assert.ok(deterministicChecks({ ...exploited, response: { status: 200, body: {} } }).some((c) => !c.pass));
});

test("deterministic checks: CLEAN needs 401/403", () => {
  assert.ok(deterministicChecks(clean).every((c) => c.pass));
  assert.ok(deterministicChecks({ ...clean, response: { status: 200, body: { leak: true } } }).some((c) => !c.pass));
});

test("auditor: does not call the model when deterministic checks fail (cheap fail)", async () => {
  let calls = 0;
  const counting: ModelCall = async () => { calls += 1; return okModel("", ""); };
  const bad = { ...exploited, response: { status: 401, body: { e: 1 } } };
  const r = await auditFinding(bad, counting, "z-ai/glm-5.3-flash");
  assert.equal(r.auditor_ok, false);
  assert.equal(calls, 0, "model must not be called once the evidence is inconsistent");
  assert.match(r.reason, /does not support/);
});

test("auditor: EXPLOITED with data + model confirm → auditor_ok true", async () => {
  const r = await auditFinding(exploited, okModel, "z-ai/glm-5.3-flash");
  assert.equal(r.auditor_ok, true);
  assert.equal(r.model, "z-ai/glm-5.3-flash");
  assert.ok(r.checks.length >= 4);
});

test("auditor: model rejection overrides a deterministically-consistent finding", async () => {
  const r = await auditFinding(exploited, rejectModel, "z-ai/glm-5.3-flash");
  assert.equal(r.auditor_ok, false);
  assert.match(r.reason, /not convinced/);
});

test("auditor: tolerates a fenced JSON model response", async () => {
  const r = await auditFinding(exploited, fencedModel, "z-ai/glm-5.3-flash");
  assert.equal(r.auditor_ok, true);
});

test("auditor: fails closed if the independent model call throws", async () => {
  const r = await auditFinding(exploited, throwModel, "z-ai/glm-5.3-flash");
  assert.equal(r.auditor_ok, false);
  assert.match(r.reason, /auditor unavailable/);
});
