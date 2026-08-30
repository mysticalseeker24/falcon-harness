import { AUDITOR_MODEL, WRITER_MODEL } from "@/lib/demo";

const short = (m: string) => m.split("/")[1] ?? m;

export function TopBar() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">F</div>
        <div>
          <div className="brand-name">Falcon</div>
          <div className="brand-sub">Evidence Console</div>
        </div>
      </div>
      <p className="masthead-thesis">
        Reads a pull request, boots the target in an isolated sandbox, and runs a <b>real exploit</b> —
        returns a request, a response, and a verdict. A proven fact, not a severity guess.
      </p>
      <div className="topbar-spacer" />
      <div className="model-badges">
        <span className="mbadge">
          <span className="dot" /> writer <b>{short(WRITER_MODEL)}</b>
        </span>
        <span className="mbadge">
          <span className="dot alt" /> auditor <b>{short(AUDITOR_MODEL)}</b>
        </span>
        <span className="mbadge">
          <span className="dot live" /> <b>live</b>
        </span>
      </div>
    </header>
  );
}
