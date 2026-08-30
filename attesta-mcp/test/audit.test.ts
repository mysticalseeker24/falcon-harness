import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveVerdict } from "../src/lib/verdict.js";
import { staticAdvisory } from "../src/lib/advisory.js";
import type { Probe } from "../src/lib/auditor.js";
import type { ScopedRoute } from "../src/lib/scopeSurface.js";

function probe(expected: "deny" | "allow", status: number, body: unknown, auth: Probe["auth_context"] = "unauthenticated"): Probe {
  return {
    label: `${expected}-${status}`,
    auth_context: auth,
    expected,
    request: { method: "GET", url: "http://t/admin/x", headers: {}, body: null },
    response: { status, headers: {}, body },
  };
}

test("deriveVerdict: a denied request that returns 2xx+data is EXPLOITED", () => {
  const v = deriveVerdict([
    probe("deny", 200, { secret: 1 }),
    probe("allow", 200, { ok: 1 }, "authorized"),
  ]);
  assert.equal(v, "EXPLOITED");
});

test("deriveVerdict: all denied + an authorized success with data is CLEAN", () => {
  const v = deriveVerdict([
    probe("deny", 401, { error: "no auth" }),
    probe("deny", 403, { error: "forbidden" }, "non-admin"),
    probe("allow", 200, { data: [1] }, "authorized"),
  ]);
  assert.equal(v, "CLEAN");
});

test("deriveVerdict: no allow probe → cannot confirm CLEAN → INCONCLUSIVE", () => {
  const v = deriveVerdict([probe("deny", 401, null), probe("deny", 403, null, "non-admin")]);
  assert.equal(v, "INCONCLUSIVE");
});

test("deriveVerdict: an authorized 2xx with an empty body is not proof → INCONCLUSIVE", () => {
  const v = deriveVerdict([probe("deny", 401, null), probe("allow", 200, {}, "authorized")]);
  assert.equal(v, "INCONCLUSIVE");
});

test("deriveVerdict: an unreachable target (status 0) is not EXPLOITED", () => {
  const v = deriveVerdict([probe("deny", 0, null), probe("allow", 0, null, "authorized")]);
  assert.equal(v, "INCONCLUSIVE");
});

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
  const guarded = a.find((x) => x.route === "/me")!;
  assert.equal(guarded.severity, "info");
  assert.equal(guarded.kind, "guarded-new-endpoint");
});
