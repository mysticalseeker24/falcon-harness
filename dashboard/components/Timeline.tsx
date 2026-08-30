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
        <h3>Live activity</h3>
        <span className="eyebrow">what it&apos;s doing</span>
      </div>
      <div className="panel-body">
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
