// Static advisory — the instant, sandbox-free half of audit_change. From the scoped diff alone,
// flag every NEW endpoint that has no auth middleware detected. This is a *heuristic* signal
// (regex over the diff, no reachability), so it is labelled advisory: not a proof, a prompt to check.
import type { ScopedRoute } from "./scopeSurface.js";

export interface Advisory {
  method: string;
  route: string;
  source_line: number;
  severity: "high" | "info";
  kind: "unguarded-new-endpoint" | "guarded-new-endpoint";
  advisory: true;
  message: string;
}

export function staticAdvisory(routes: ScopedRoute[]): Advisory[] {
  return routes.map((r) =>
    r.auth_present
      ? {
          method: r.method,
          route: r.path,
          source_line: r.source_line,
          severity: "info",
          kind: "guarded-new-endpoint",
          advisory: true,
          message: `New endpoint ${r.method} ${r.path} has an auth middleware attached — looks guarded (confirm it enforces the right role/tenant).`,
        }
      : {
          method: r.method,
          route: r.path,
          source_line: r.source_line,
          severity: "high",
          kind: "unguarded-new-endpoint",
          advisory: true,
          message:
            `New endpoint ${r.method} ${r.path} has NO authentication/authorization middleware detected in the diff. ` +
            `If it exposes sensitive data or actions, this is a broken-access-control risk. Add a guard, or confirm the route is intentionally public. ` +
            `This is a heuristic advisory — the execution-proven exploit runs in the isolated sandbox (the agent/harness pipeline), not from this tool.`,
        },
  );
}
