interface Props {
  which: "vuln" | "safe";
  setWhich: (w: "vuln" | "safe") => void;
  onRun: () => void;
  running: boolean;
}

export function CommandBar({ which, setWhich, onRun, running }: Props) {
  const url =
    which === "vuln"
      ? "https://github.com/DevLab-mgc/vulnbank/pull/3"
      : "https://github.com/DevLab-mgc/vulnbank/pull/4";
  return (
    <div className="commandbar">
      <div className="seg" role="tablist" aria-label="target PR">
        <button data-on={which === "vuln"} onClick={() => setWhich("vuln")} disabled={running}>
          PR #3 · vuln
        </button>
        <button data-on={which === "safe"} onClick={() => setWhich("safe")} disabled={running}>
          PR #4 · safe
        </button>
      </div>
      <label className="field">
        <span className="eyebrow">target</span>
        <input readOnly value={url} aria-label="target PR url" />
      </label>
      <button className="btn btn-primary" onClick={onRun} disabled={running}>
        {running ? "Running…" : "Run Falcon"}
      </button>
    </div>
  );
}
