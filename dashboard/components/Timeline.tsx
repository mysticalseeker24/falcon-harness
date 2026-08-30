import type { RunStep } from "@/lib/types";

function Glyph({ status }: { status: RunStep["status"] }) {
  if (status === "active") return <span className="spinner" aria-label="running" />;
  if (status === "done") return <>✓</>;
  if (status === "error") return <>!</>;
  return <>○</>;
}

export function Timeline({ steps }: { steps: RunStep[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Activity</h3>
        <span className="badge-demo" title="a faithful replay of a real recorded run">replay</span>
      </div>
      <div className="panel-body">
        <div className="replay-note">
          Replay of a recorded Falcon run — the live agent run (sandbox boot + probe) happens in the TrueForge harness.
        </div>
        <div className="steps">
          {steps.map((s) => (
            <div className="step" data-st={s.status} key={s.key}>
              <div className="step-ic">
                <Glyph status={s.status} />
              </div>
              <div>
                <div className="step-label">{s.label}</div>
                {s.detail ? <div className={"step-detail" + (s.mono ? " mono" : "")}>{s.detail}</div> : null}
              </div>
              <div className="step-time">{s.at != null ? `${(s.at / 1000).toFixed(1)}s` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
