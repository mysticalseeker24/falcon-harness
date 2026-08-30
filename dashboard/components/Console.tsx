"use client";

import { useCallback, useEffect, useState } from "react";
import { SCENARIOS, initialRun } from "@/lib/demo";
import type { LedgerState, RunState, RunStep } from "@/lib/types";
import { TopBar } from "./TopBar";
import { CommandBar } from "./CommandBar";
import { Timeline } from "./Timeline";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { VerdictBanner } from "./VerdictBanner";
import { ApprovalCard } from "./ApprovalCard";
import { LedgerPanel } from "./LedgerPanel";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (m: string) => m.split("/")[1] ?? m;

export function Console() {
  const [which, setWhich] = useState<"vuln" | "safe">("vuln");
  const [run, setRun] = useState<RunState>(() => initialRun("vuln"));
  const [ledger, setLedger] = useState<LedgerState>({ entries: [], verify: null });

  const refreshLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/ledger", { cache: "no-store" });
      const data = (await res.json()) as LedgerState;
      setLedger((s) => ({ ...s, entries: data.entries ?? [] }));
    } catch {
      /* dashboard stays presentable even if attesta-mcp is down */
    }
  }, []);

  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  // Switching target resets the run panels (unless a run is in flight).
  useEffect(() => {
    setRun((r) => (r.running ? r : initialRun(which)));
  }, [which]);

  const runFalcon = useCallback(async () => {
    const sc = SCENARIOS[which];
    const t0 = Date.now();
    setRun({ ...initialRun(which), running: true });
    const at = () => Date.now() - t0;
    const setStep = (key: string, patch: Partial<RunStep>) =>
      setRun((r) => ({ ...r, steps: r.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

    setStep("scope", { status: "active" });
    await sleep(750);
    setStep("scope", { status: "done", detail: sc.scopeDetail, mono: true, at: at() });

    setStep("boot", { status: "active" });
    await sleep(1150);
    setStep("boot", { status: "done", detail: 'health → 200 {"ok":true}', mono: true, at: at() });

    setStep("probe", { status: "active" });
    await sleep(1000);
    setRun((r) => ({ ...r, evidence: sc.evidence }));
    setStep("probe", { status: "done", detail: sc.probeDetail, mono: true, at: at() });

    setStep("audit", { status: "active" });
    await sleep(950);
    setRun((r) => ({ ...r, auditorOk: true }));
    setStep("audit", { status: "done", detail: `${short(AUDITOR)} confirmed`, at: at() });

    setStep("seal", { status: "active" });
    await sleep(800);
    setStep("seal", { status: "done", detail: `entry ${sc.entryHash.slice(0, 12)}…`, mono: true, at: at() });

    setRun((r) => ({
      ...r,
      verdict: sc.verdict,
      reason: sc.reason,
      entryHash: sc.entryHash,
      running: false,
      approval: { required: sc.verdict === "CLEAN", resolved: null },
    }));
    void refreshLedger();
  }, [which, refreshLedger]);

  const ledgerAction = useCallback(async (action: "verify" | "tamper" | "restore") => {
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        cache: "no-store",
      });
      const data = (await res.json()) as LedgerState;
      setLedger({ entries: data.entries ?? [], verify: action === "verify" ? data.verify ?? null : null });
    } catch {
      /* ignore */
    }
  }, []);

  const resolveApproval = (decision: "approved" | "rejected") =>
    setRun((r) => ({ ...r, approval: { ...r.approval, resolved: decision } }));

  return (
    <div className="shell">
      <TopBar />
      <CommandBar which={which} setWhich={setWhich} onRun={runFalcon} running={run.running} />
      <div className="grid">
        <Timeline steps={run.steps} />
        <EvidenceDrawer evidence={run.evidence} auditorModel={run.auditorModel} auditorOk={run.auditorOk} />
        <VerdictBanner verdict={run.verdict} reason={run.reason} entryHash={run.entryHash} running={run.running} />
        {run.approval.required ? (
          <ApprovalCard
            pr={run.target.pr}
            resolved={run.approval.resolved}
            onApprove={() => resolveApproval("approved")}
            onReject={() => resolveApproval("rejected")}
          />
        ) : null}
        <LedgerPanel
          entries={ledger.entries}
          verify={ledger.verify}
          onVerify={() => ledgerAction("verify")}
          onTamper={() => ledgerAction("tamper")}
          onRestore={() => ledgerAction("restore")}
        />
      </div>
    </div>
  );
}

const AUDITOR = "z-ai/glm-5.3-flash";
