import { test } from "node:test";
import assert from "node:assert/strict";
import { staticAdvisory } from "../src/lib/advisory.js";
import type { ScopedRoute } from "../src/lib/scopeSurface.js";

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
