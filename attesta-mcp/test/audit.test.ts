import { test } from "node:test";
import assert from "node:assert/strict";
import { staticAdvisory } from "../src/lib/advisory.js";
import { suggestGuard } from "../src/lib/suggestGuard.js";
import type { ScopedRoute } from "../src/lib/scopeSurface.js";

const modelReturning = (out: string) => async () => out;
const REQ = { method: "GET", route: "/admin/payroll" };

test("staticAdvisory: an unguarded new route is a HIGH advisory; a guarded one is info", () => {
  const routes: ScopedRoute[] = [
    { method: "GET", path: "/admin/balances", handler: "inline", auth_present: false, source_line: 21 },
    { method: "GET", path: "/me", handler: "inline", auth_present: true, source_line: 40 },
  ];
  const a = staticAdvisory(routes);
  assert.equal(a.length, 2);
  const unguarded = a.find((x) => x.route === "/admin/balances")!;
  assert.equal(unguarded.severity, "high");
  assert.equal(unguarded.kind, "unguarded-new-endpoint");
  assert.equal(unguarded.advisory, true);
  const guarded = a.find((x) => x.route === "/me")!;
  assert.equal(guarded.severity, "info");
  assert.equal(guarded.kind, "guarded-new-endpoint");
});

test("staticAdvisory: an unguarded advisory never claims to be a proof", () => {
  const [only] = staticAdvisory([{ method: "DELETE", path: "/admin/users/1", handler: "inline", auth_present: false, source_line: 3 }]);
  assert.equal(only.advisory, true);
  assert.match(only.message, /advisory|no authentication|confirm/i);
});

test("suggestGuard: strict JSON with a non-empty suggestion is accepted", async () => {
  const r = await suggestGuard(REQ, modelReturning('{"suggestion":"router.use(requireAuth)","explanation":"adds auth"}'), "m");
  assert.equal(r.available, true);
  assert.match(r.suggestion ?? "", /requireAuth/);
});

test("suggestGuard: a valid fenced code block (non-JSON) is accepted and the prose becomes the explanation", async () => {
  const r = await suggestGuard(REQ, modelReturning("```ts\nrouter.use(requireAuth, requireAdmin);\n```\nEnforces admin authentication."), "m");
  assert.equal(r.available, true);
  assert.match(r.suggestion ?? "", /requireAdmin/);
  assert.match(r.explanation ?? "", /admin/i);
});

test("suggestGuard: malformed JSON that still contains a fenced code block is accepted", async () => {
  const r = await suggestGuard(REQ, modelReturning("{ not: valid json ```ts\nrequireAuth\n``` trailing"), "m");
  assert.equal(r.available, true);
  assert.match(r.suggestion ?? "", /requireAuth/);
});

test("suggestGuard: a refusal with NO code block is rejected", async () => {
  const r = await suggestGuard(REQ, modelReturning("I can't help with that request."), "m");
  assert.equal(r.available, false);
  assert.match(r.reason ?? "", /no (usable )?guard|no code block/i);
});

test("suggestGuard: an empty fenced block is rejected", async () => {
  const r = await suggestGuard(REQ, modelReturning("```\n\n```"), "m");
  assert.equal(r.available, false);
});

test("suggestGuard: an empty fence followed by a non-empty fence uses the non-empty one", async () => {
  const r = await suggestGuard(REQ, modelReturning("```\n\n```\n```ts\nrouter.use(requireAuth);\n```\nGuards the route."), "m");
  assert.equal(r.available, true);
  assert.match(r.suggestion ?? "", /requireAuth/);
});

test("suggestGuard: no configured model (null) is rejected as not-configured", async () => {
  const r = await suggestGuard(REQ, null, "m");
  assert.equal(r.available, false);
  assert.match(r.reason ?? "", /not configured/i);
});

test("suggestGuard: a model/transport error is rejected without leaking the error", async () => {
  const throwing = async () => { throw new Error("boom secret"); };
  const r = await suggestGuard(REQ, throwing, "m");
  assert.equal(r.available, false);
  assert.doesNotMatch(r.reason ?? "", /boom secret/);
});
