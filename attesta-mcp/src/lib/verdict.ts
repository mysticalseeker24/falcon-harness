// Deriving an access-control verdict from a set of captured probes — the generic (non-fixture)
// version used by audit_change. A verdict is a fact about what the running target actually did.
import type { Probe } from "./auditor.js";

export type Verdict = "EXPLOITED" | "CLEAN" | "INCONCLUSIVE";

// A response "carries data" if its body is a non-empty string/array/object. Used to decide whether a
// request that should have been refused actually leaked something.
export function bodyHasData(b: unknown): boolean {
  if (b === undefined || b === null) return false;
  if (typeof b === "string") return b.trim().length > 0;
  if (Array.isArray(b)) return b.length > 0;
  if (typeof b === "object") return Object.keys(b).length > 0;
  return true;
}

const is2xx = (s: number) => s >= 200 && s < 300;
const isDenied = (s: number) => s === 401 || s === 403;

// EXPLOITED: a request that SHOULD have been denied returned success + data (proven exposure).
// CLEAN: positive proof on both sides — every deny-probe actually denied AND at least one authorized
//        probe succeeded with data. Anything short of that is INCONCLUSIVE (never guessed CLEAN).
export function deriveVerdict(probes: Probe[]): Verdict {
  const deny = probes.filter((p) => p.expected === "deny");
  const allow = probes.filter((p) => p.expected === "allow");
  const leak = deny.some((p) => is2xx(p.response.status) && bodyHasData(p.response.body));
  if (leak) return "EXPLOITED";
  const allDenied = deny.length > 0 && deny.every((p) => isDenied(p.response.status));
  const allowProven = allow.length > 0 && allow.every((p) => is2xx(p.response.status) && bodyHasData(p.response.body));
  return allDenied && allowProven ? "CLEAN" : "INCONCLUSIVE";
}
