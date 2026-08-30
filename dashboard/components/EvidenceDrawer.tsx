import type { Exchange, Verdict } from "@/lib/types";

const short = (m: string) => m.split("/")[1] ?? m;

export function EvidenceDrawer({
  evidence,
  auditorModel,
  auditorOk,
  verdict,
}: {
  evidence: Exchange | null;
  auditorModel: string;
  auditorOk: boolean | null;
  verdict: Verdict | null;
}) {
  const is2xx = evidence != null && evidence.status >= 200 && evidence.status < 300;
  const denied = evidence != null && (evidence.status === 401 || evidence.status === 403);
  const auth = evidence?.reqHeaders.authorization;
  // Honest labelling: HTTP status alone does not prove a leak. A 2xx is an "unauthorized disclosure"
  // only once the *verified verdict* is EXPLOITED; a 401/403 is a factual denial; anything else stays
  // neutral (an authorized allow-probe, or the window before the verdict resolves).
  const kind: "leak" | "deny" | "neutral" = verdict === "EXPLOITED" && is2xx ? "leak" : denied ? "deny" : "neutral";
  const tag = kind === "leak" ? "unauthorized disclosure" : kind === "deny" ? "access denied" : null;
  const pillClass = kind === "leak" ? "status-2xx" : kind === "deny" ? "status-deny" : "status-ok";
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Evidence</h3>
        <span className="eyebrow">request · response</span>
      </div>
      <div className="panel-body">
        {!evidence ? (
          <div className="empty">Run Falcon to capture the request &amp; response.</div>
        ) : (
          <div className="evidence">
            <div className="exch req">
              <div className="exch-head">
                <span className="method">{evidence.method}</span>
                <span className="exch-url">{evidence.url}</span>
              </div>
              <pre>
                {"Authorization: "}
                {auth ? <span className="redact">•••• redacted</span> : <span className="redact">(none — unauthenticated)</span>}
                {"\n\n" + (evidence.reqBody == null ? "(no request body)" : JSON.stringify(evidence.reqBody, null, 2))}
              </pre>
            </div>
            <div className={"exch " + kind}>
              <div className="exch-head">
                <span className={"status-pill " + pillClass}>{evidence.status}</span>
                <span className="eyebrow">response</span>
                {tag ? <span className={"leak-tag " + kind}>{tag}</span> : null}
              </div>
              <pre>{JSON.stringify(evidence.resBody, null, 2)}</pre>
            </div>
            {auditorOk != null ? (
              <div className="auditchip">
                <span className="dot" /> Independently audited by <b>{short(auditorModel)}</b> (≠ writer family):{" "}
                {auditorOk ? "confirmed" : "rejected"}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
