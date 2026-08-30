import type { Verdict } from "@/lib/types";

export function VerdictBanner({
  verdict,
  reason,
  entryHash,
  running,
}: {
  verdict: Verdict | null;
  reason: string | null;
  entryHash: string | null;
  running: boolean;
}) {
  const v = verdict ?? "idle";
  return (
    <section className="verdict span-2" data-v={v}>
      <div className="verdict-badge">{verdict ?? (running ? "ANALYSING…" : "AWAITING RUN")}</div>
      <div className="verdict-reason">
        {reason ?? "A proven fact — a captured request, a captured response, and a verdict. Not a severity guess."}
      </div>
      {entryHash ? (
        <div className="verdict-hash">
          <div className="eyebrow">sealed entry</div>
          <div className="h">{entryHash.slice(0, 16)}…</div>
        </div>
      ) : null}
    </section>
  );
}
