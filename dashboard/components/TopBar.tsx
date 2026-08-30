import { AUDITOR_MODEL, WRITER_MODEL } from "@/lib/demo";

const short = (m: string) => m.split("/")[1] ?? m;

export function TopBar({ ledgerLive = false }: { ledgerLive?: boolean }) {
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
        Evidence console for <b>Falcon</b>, the diff-scoped exploitation agent. Falcon boots targets in a
        sandbox and proves broken access control <b>inside the TrueForge harness</b>; here you replay a
        recorded run and verify the tamper-evident ledger live.
      </p>
      <div className="topbar-spacer" />
      <div className="model-badges">
        <span className="mbadge">
          <span className="dot" /> writer <b>{short(WRITER_MODEL)}</b>
        </span>
        <span className="mbadge">
          <span className="dot alt" /> auditor <b>{short(AUDITOR_MODEL)}</b>
        </span>
        {/* Reflects the real backend/ledger connection, not a decorative claim. */}
        <span className="mbadge">
          <span className={"dot " + (ledgerLive ? "live" : "off")} /> ledger <b>{ledgerLive ? "live" : "offline"}</b>
        </span>
      </div>
    </header>
  );
}
