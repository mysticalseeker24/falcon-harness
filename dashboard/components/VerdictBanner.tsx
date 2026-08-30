import type { SealMatch, Verdict } from "@/lib/types";

export function VerdictBanner({
  verdict,
  reason,
  entryHash,
  sealMatch,
  running,
}: {
  verdict: Verdict | null;
  reason: string | null;
  entryHash: string | null;
  sealMatch: SealMatch;
  running: boolean;
}) {
  const v = verdict ?? "idle";
  // Honest labelling: the entry_hash shown here comes from a replay. Only call it "sealed" when it
  // was actually found in the live ledger; otherwise it is replay evidence, not a fresh seal.
  const live = sealMatch === "live";
  return (
    <section className="verdict span-2" data-v={v}>
      <div className="verdict-badge">{verdict ?? (running ? "ANALYSING…" : "AWAITING RUN")}</div>
      <div className="verdict-reason">
        {reason ?? "A proven fact — a captured request, a captured response, and a verdict. Not a severity guess."}
      </div>
      {entryHash ? (
        <div className="verdict-hash">
          <div className="eyebrow">{live ? "sealed entry · in live ledger" : "replay entry · not in live ledger"}</div>
          <div className="h">{entryHash.slice(0, 16)}…</div>
        </div>
      ) : null}
    </section>
  );
}
