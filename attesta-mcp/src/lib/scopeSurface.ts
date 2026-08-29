// scope_surface — work out the new HTTP attack surface a PR diff introduces.
//
// Pure, dependency-free, and deliberately regex-based (no AST/tree-sitter): it reads the ADDED
// lines of a unified diff, finds new Express route registrations, and records whether an auth
// middleware is attached. Honest scope, stated plainly:
//   - Detects `<router>.<method>("/path", ...)` when the registration BEGINS the added line (an
//     executable position — not inside a comment or a string), method + path on that one line.
//   - `auth_present` is true only when a known auth-middleware identifier appears in the
//     MIDDLEWARE ARGUMENTS (before the handler function), with comments and string contents
//     stripped so they cannot masquerade as middleware.
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

// Route registration, ANCHORED to the start of the (trimmed) added line. Router var is any
// identifier (app, router, adminRouter, …). Path must start with "/" so we don't match unrelated
// calls like `cache.get("key")`.
const ROUTE =
  /^(\w[\w$]*)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])(\/[^'"`]*)\3\s*(.*)$/;

// Hunk header: @@ -oldStart[,oldLen] +newStart[,newLen] @@
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Everything before the handler function body, with comments and string contents removed, so an
// identifier in the callback body / a comment / a string cannot be read as middleware.
function middlewareArgs(tail: string): string {
  const arrowAt = tail.indexOf("=>");
  const region = arrowAt === -1 ? tail : tail.slice(0, arrowAt);
  return region
    .replace(/\/\/.*$/, "") // line comment
    .replace(/(['"`])(?:\\.|[^\\])*?\1/g, ""); // string literals -> empty
}

function describeHandler(tail: string): string {
  const beforeArrow = tail
    .split("=>")[0]
    .replace(/^[\s,]+/, "") // leading comma between path and handler
    .replace(/[,{(\s]+$/, "")
    .trim();
  if (beforeArrow === "" || beforeArrow.startsWith("(")) return "inline";
  return beforeArrow;
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
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
    // File/section headers. The trailing space distinguishes "+++ b/file" / "--- a/file" from
    // added/removed source such as "+++counter;" / "---counter;". These also end the current hunk.
    if (
      raw.startsWith("diff --git ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      inHunk = false;
      continue;
    }

    const hunk = HUNK.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    // "\ No newline at end of file" — metadata; advances neither counter.
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    if (marker === "+") {
      const trimmed = raw.slice(1).replace(/^\s+/, "");
      if (!isCommentLine(trimmed)) {
        const m = ROUTE.exec(trimmed);
        if (m) {
          const [, , method, , path, tail] = m;
          routes.push({
            method: method.toUpperCase(),
            path,
            handler: describeHandler(tail),
            auth_present: AUTH_IDENTIFIER.test(middlewareArgs(tail)),
            source_line: newLine,
          });
        }
      }
      newLine += 1;
    } else if (marker === "-") {
      // Removed line — present only in the old file; do not advance the new-file counter.
    } else {
      // Context line — advances the new-file counter.
      newLine += 1;
    }
  }

  return { routes };
}
