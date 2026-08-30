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
          In a live run the real gate lives in the harness: on approval, the agent seals an{" "}
          <code>APPROVAL</code> entry (who approved, which CLEAN finding, when) <b>before</b> resuming the
          TrueForge <code>tool.approval_required</code> merge (see GATE.md). This panel is the{" "}
          <b>replay</b> of that decision — it records your choice here but does not itself fire the merge or
          seal the approval.
        </div>
      </div>
      {resolved ? (
        <div className="approval-done">
          {resolved === "approved" ? "✓ Approved (replay) — in a live run this seals the approval, then the merge fires" : "✗ Rejected (replay) — no merge"}
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
