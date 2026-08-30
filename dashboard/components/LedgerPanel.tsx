import type { LedgerEntryView, VerifyResult } from "@/lib/types";

const short = (m: string | null) => (m ? m.split("/")[1] ?? m : null);
// Never assume an integrity field is a string — a corrupt row could carry anything.
const hash = (h: unknown, n: number) => (typeof h === "string" ? h.slice(0, n) : "—");

export function LedgerPanel({
  entries,
  verify,
  error,
  demoMutable,
  onVerify,
  onTamper,
  onRestore,
}: {
  entries: LedgerEntryView[];
  verify: VerifyResult | null;
  error: string | null;
  demoMutable: boolean;
  onVerify: () => void;
  onTamper: () => void;
  onRestore: () => void;
}) {
  return (
    <section className="panel span-2">
      <div className="panel-head">
        <h3>Tamper-evident ledger</h3>
        <div className="ledger-tools">
          {verify ? (
            <span className={"verify-state " + (verify.valid ? "valid" : "invalid")}>
              {verify.valid ? `✓ chain valid · ${verify.length} entries` : `✗ broken at ${verify.broken_at ?? "?"}`}
            </span>
          ) : null}
          <button className="btn btn-ghost" onClick={onVerify}>
            Verify chain
          </button>
          {demoMutable ? (
            <>
              <span className="badge-demo">demo</span>
              <button className="btn btn-danger" onClick={onTamper}>
                Tamper
              </button>
              <button className="btn btn-ghost" onClick={onRestore}>
                Restore
              </button>
            </>
          ) : null}
        </div>
      </div>
      {error ? <div className="panel-error">⚠ {error}</div> : null}
      <div className="panel-body">
        {entries.length === 0 ? (
          <div className="empty">No sealed entries yet — run Falcon, or the agent, to seal one.</div>
        ) : (
          <div className="chain">
            {entries.map((e) => (
              <div className="lentry" data-broken={Boolean(verify && !verify.valid && verify.broken_at === e.id)} key={e.id}>
                <div className="lseal">◆</div>
                <div className="lentry-main">
                  <span className={"lverdict " + e.verdict}>{e.verdict}</span>
                  <div className="lmeta">
                    {(e.route ?? "—") + " · PR #" + (e.pr_number ?? "?")}
                    {short(e.auditor_model) ? " · audited by " + short(e.auditor_model) : ""}
                  </div>
                </div>
                <div className="lhash">
                  <span className="prev">{hash(e.prev_hash, 8)}</span> <span className="arrow">→</span> {hash(e.entry_hash, 10)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
