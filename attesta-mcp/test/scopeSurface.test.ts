import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeSurface } from "../src/lib/scopeSurface.js";

// The real diff of DevLab-mgc/vulnbank PR #3 (pr/admin-balances-vuln).
const VULN_DIFF = `diff --git a/src/routes/admin.ts b/src/routes/admin.ts
index 5e24e5b..bbad5f2 100644
--- a/src/routes/admin.ts
+++ b/src/routes/admin.ts
@@ -16,3 +16,15 @@ adminRouter.get("/admin/tenants", authMiddleware, requireAdmin, (_req: Request,
 adminRouter.get("/admin/accounts", authMiddleware, requireAdmin, (_req: Request, res: Response) => {
   res.json({ accounts: allAccounts() });
 });
+
+// Ops balances overview across the bank.
+adminRouter.get("/admin/balances", (_req: Request, res: Response) => {
+  const balances = allAccounts().map((a) => ({
+    id: a.id,
+    tenantId: a.tenantId,
+    owner: a.owner,
+    balance: a.balance,
+    currency: a.currency,
+  }));
+  res.json({ balances });
+});`;

// The real diff of PR #4 (pr/admin-balances-safe) — same route, WITH the guards.
const SAFE_DIFF = VULN_DIFF.replace(
  `adminRouter.get("/admin/balances", (_req: Request, res: Response) => {`,
  `adminRouter.get("/admin/balances", authMiddleware, requireAdmin, (_req: Request, res: Response) => {`,
).replace("Ops balances overview across the bank.", "Ops balances overview across the bank. Admin-only, like the routes above.");

test("vuln diff: one new route, auth absent, correct method/path/line", () => {
  const { routes } = scopeSurface(VULN_DIFF);
  assert.equal(routes.length, 1, "should detect exactly the one added route");
  const r = routes[0];
  assert.equal(r.method, "GET");
  assert.equal(r.path, "/admin/balances");
  assert.equal(r.auth_present, false);
  assert.equal(r.handler, "inline");
  assert.equal(r.source_line, 21);
});

test("safe diff: same route but auth present", () => {
  const { routes } = scopeSurface(SAFE_DIFF);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/admin/balances");
  assert.equal(routes[0].auth_present, true);
});

test("context lines and hunk headings are not treated as new routes", () => {
  // /admin/accounts (context, leading space) and /admin/tenants (in the @@ heading) must be ignored.
  const paths = scopeSurface(VULN_DIFF).routes.map((r) => r.path);
  assert.deepEqual(paths, ["/admin/balances"]);
});

test("app.get style is detected with auth present", () => {
  const diff = `--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,2 @@
 const x = 1;
+app.get("/foo/bar", authMiddleware, handler);`;
  const { routes } = scopeSurface(diff);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].method, "GET");
  assert.equal(routes[0].path, "/foo/bar");
  assert.equal(routes[0].auth_present, true);
  assert.equal(routes[0].source_line, 2);
});

test("non-route .get calls (path not starting with /) are ignored", () => {
  const diff = `@@ -1,1 +1,2 @@
 const cache = new Map();
+cache.get("some-key");`;
  assert.equal(scopeSurface(diff).routes.length, 0);
});

test("removed lines do not advance the new-file line counter", () => {
  const diff = `@@ -1,3 +1,3 @@
 const a = 1;
-const removed = 2;
+app.post("/created", requireAdmin, h);`;
  const { routes } = scopeSurface(diff);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].method, "POST");
  assert.equal(routes[0].source_line, 2);
});

test("multiple added routes are all captured", () => {
  const diff = `@@ -1,0 +1,3 @@
+app.get("/a", h);
+router.post("/b", authMiddleware, h);
+adminRouter.delete("/c", (req, res) => {});`;
  const { routes } = scopeSurface(diff);
  assert.deepEqual(
    routes.map((r) => [r.method, r.path, r.auth_present]),
    [
      ["GET", "/a", false],
      ["POST", "/b", true],
      ["DELETE", "/c", false],
    ],
  );
});

test("auth identifiers inside the handler body do NOT count as middleware (#3)", () => {
  const diff = `@@ -1,0 +1,1 @@
+app.get("/public", (_req, res) => { requireAdmin(); res.send("ok"); });`;
  const { routes } = scopeSurface(diff);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/public");
  assert.equal(routes[0].auth_present, false, "requireAdmin in the body is not attached auth");
});

test("route-looking text in comments and strings is not a route (#4)", () => {
  const diff = `@@ -1,0 +1,3 @@
+// app.get("/from-comment", authMiddleware, handler);
+const example = "router.post('/from-string', handler)";
+ * app.delete("/from-block-comment", handler)`;
  assert.equal(scopeSurface(diff).routes.length, 0);
});

test("real route still detected among comment/string noise (#4)", () => {
  const diff = `@@ -1,0 +1,2 @@
+// app.get("/noise", handler);
+app.get("/real", authMiddleware, handler);`;
  const { routes } = scopeSurface(diff);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/real");
  assert.equal(routes[0].auth_present, true);
});

test("\\ No newline at end of file marker does not advance the counter (#5)", () => {
  const diff = `@@ -1,1 +1,2 @@
 keep = 0;
\\ No newline at end of file
+app.get("/eof-route", h);`;
  const { routes } = scopeSurface(diff);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].source_line, 2);
});

test("added line beginning with ++ is content, not a header, and advances the counter (#6)", () => {
  const diff = `@@ -1,1 +1,3 @@
 let counter = 0;
+++counter;
+app.get("/after-incr", h);`;
  const { routes } = scopeSurface(diff);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/after-incr");
  assert.equal(routes[0].source_line, 3);
});

test("oversized diff is rejected", () => {
  const big = "+".repeat(1_000_001);
  assert.throws(() => scopeSurface(big), /exceeds/);
});
