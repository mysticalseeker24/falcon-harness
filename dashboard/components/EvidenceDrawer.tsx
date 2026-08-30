import type { Exchange } from "@/lib/types";

const short = (m: string) => m.split("/")[1] ?? m;

export function EvidenceDrawer({
  evidence,
  auditorModel,
  auditorOk,
}: {
  evidence: Exchange | null;
  auditorModel: string;
  auditorOk: boolean | null;
}) {
  const is2xx = evidence != null && evidence.status >= 200 && evidence.status < 300;
  const auth = evidence?.reqHeaders.authorization;
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
            <div className={"exch " + (is2xx ? "leak" : "deny")}>
              <div className="exch-head">
                <span className={"status-pill " + (is2xx ? "status-2xx" : "status-deny")}>{evidence.status}</span>
                <span className="eyebrow">response</span>
                <span className={"leak-tag " + (is2xx ? "leak" : "deny")}>{is2xx ? "data leaked" : "access denied"}</span>
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
