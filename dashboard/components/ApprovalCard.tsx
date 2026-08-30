export function ApprovalCard({
  pr,
  resolved,
  onApprove,
  onReject,
}: {
  pr: number;
  resolved: "approved" | "rejected" | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <section className="approval span-2">
      <div className="lseal">✓</div>
      <div className="approval-body">
        <div className="approval-title">
          Falcon proposes merge of <b>vulnbank PR #{pr}</b> — verdict CLEAN.
        </div>
        <div className="approval-note">
          The merge is irreversible. It fires only after you approve; the approval itself is sealed to the ledger
          (who approved, which finding, when).
        </div>
      </div>
      {resolved ? (
        <div className="approval-done">
          ✓ {resolved === "approved" ? "Approved — merge fired, approval sealed" : "Rejected — no merge"}
        </div>
      ) : (
        <div className="approval-actions">
          <button className="btn btn-primary" onClick={onApprove}>
            Approve
          </button>
          <button className="btn btn-ghost" onClick={onReject}>
            Reject
          </button>
        </div>
      )}
    </section>
  );
}
