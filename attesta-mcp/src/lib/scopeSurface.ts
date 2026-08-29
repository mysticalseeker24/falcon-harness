// scope_surface — work out the new HTTP attack surface a PR diff introduces.
//
// Pure, dependency-free, and deliberately regex-based (no AST/tree-sitter): it reads the ADDED
// lines of a unified diff, finds new Express route registrations, and records whether an auth
// middleware is attached. Honest scope, stated plainly:
//   - Detects `<router>.<method>("/path", ...)` where the method + path are on one added line.
//   - `auth_present` is true when a known auth-middleware identifier appears in the handler chain
//     ON THAT LINE. Middleware split onto separate lines is not followed (single-line assumption).
// The diff is untrusted input: bounded in size, never evaluated, never interpolated anywhere.

export interface ScopedRoute {
  method: string;
  path: string;
  handler: string;
  auth_present: boolean;
  source_line: number;
}

export interface ScopeSurfaceResult {
  routes: ScopedRoute[];
}

// Hard cap on the diff we will process (defensive bound on untrusted input).
const MAX_DIFF_BYTES = 1_000_000;

// Known auth-middleware identifiers. Extend as the fixture / real targets grow.
const AUTH_IDENTIFIER =
  /\b(authMiddleware|requireAuth|requireAdmin|requireRole|requireUser|ensureAuth|ensureAdmin|ensureLoggedIn|isAuthenticated|verifyToken|checkAuth|passport|jwt)\b/;

// A route registration: <router>.<httpMethod>( "<path starting with />" , <rest...>
// Router var is any identifier (app, router, adminRouter, …). Path must start with "/" so we
// don't match unrelated calls like `cache.get("key")` or `map.get("id")`.
const ROUTE =
  /\b(\w[\w$]*)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])(\/[^'"`]*)\3\s*(.*)$/;

// Hunk header: @@ -oldStart[,oldLen] +newStart[,newLen] @@
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function describeHandler(tail: string): string {
  // Strip a trailing "=> {" / "=> (" arrow-body opener; report the remaining chain, or "inline".
  const beforeArrow = tail.split("=>")[0].replace(/[,{(\s]+$/, "").trim();
  if (beforeArrow === "" || beforeArrow.startsWith("(")) return "inline";
  return beforeArrow;
}

export function scopeSurface(diff: string): ScopeSurfaceResult {
  if (typeof diff !== "string") {
    throw new TypeError("diff must be a string");
  }
  if (Buffer.byteLength(diff, "utf8") > MAX_DIFF_BYTES) {
    throw new RangeError(`diff exceeds ${MAX_DIFF_BYTES} bytes`);
  }

  const routes: ScopedRoute[] = [];
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    // File headers — ignore, and they don't advance line numbers.
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) {
      continue;
    }
    if (!inHunk) continue;

    const marker = raw[0];
    if (marker === "+") {
      const content = raw.slice(1);
      const m = ROUTE.exec(content);
      if (m) {
        const [, , method, , path, tail] = m;
        routes.push({
          method: method.toUpperCase(),
          path,
          handler: describeHandler(tail),
          auth_present: AUTH_IDENTIFIER.test(tail),
          source_line: newLine,
        });
      }
      newLine += 1;
    } else if (marker === "-") {
      // Removed line — present only in the old file; do not advance the new-file counter.
    } else {
      // Context line (space) or anything else within a hunk — advances the new-file counter.
      newLine += 1;
    }
  }

  return { routes };
}
