"use client";

import { useCallback, useEffect, useState } from "react";
import { SCENARIOS, initialRun } from "@/lib/demo";
import type { LedgerEntryView, LedgerState, RunState, RunStep } from "@/lib/types";
import { TopBar } from "./TopBar";
import { CommandBar } from "./CommandBar";
import { Timeline } from "./Timeline";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { VerdictBanner } from "./VerdictBanner";
import { ApprovalCard } from "./ApprovalCard";
import { LedgerPanel } from "./LedgerPanel";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (m: string) => m.split("/")[1] ?? m;
const AUDITOR = "z-ai/glm-5.3-flash";

export function Console() {
  const [which, setWhich] = useState<"vuln" | "safe">("vuln");
  const [run, setRun] = useState<RunState>(() => initialRun("vuln"));
  const [ledger, setLedger] = useState<LedgerState>({ entries: [], verify: null, error: null, demoMutable: false });

  // Returns the freshly-read entries (or null on failure) so callers don't race React's re-render.
  const refreshLedger = useCallback(async (): Promise<LedgerEntryView[] | null> => {
    try {
      const res = await fetch("/api/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger read HTTP ${res.status}`);
      const data = (await res.json()) as Partial<LedgerState>;
      if (!Array.isArray(data.entries)) throw new Error("ledger read returned no entries array");
      const entries = data.entries;
      setLedger((s) => ({ ...s, entries, demoMutable: Boolean(data.demoMutable), error: null }));
      return entries;
    } catch (e) {
      // Keep the last-known entries visible; surface an actionable error instead of blanking.
      setLedger((s) => ({ ...s, error: e instanceof Error ? e.message : "ledger unavailable" }));
      return null;
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

    // This is a REPLAY: we do not seal here. We instead reconcile the replayed entry_hash against
    // the live ledger and report honestly whether it corresponds to a real sealed entry.
    setStep("seal", { status: "active" });
    await sleep(500);
    const live = (await refreshLedger()) ?? [];
    const sealed = live.some((e) => e.entry_hash === sc.entryHash);
    setStep("seal", {
      status: "done",
      detail: sealed ? `replay · matches sealed ${sc.entryHash.slice(0, 12)}…` : "replay · not in live ledger",
      mono: true,
      at: at(),
    });

    setRun((r) => ({
      ...r,
      verdict: sc.verdict,
      reason: sc.reason,
      entryHash: sc.entryHash,
      sealMatch: sealed ? "live" : "replay",
      running: false,
      approval: { required: sc.verdict === "CLEAN", resolved: null },
    }));
  }, [which, refreshLedger]);

  const ledgerAction = useCallback(async (action: "verify" | "tamper" | "restore") => {
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as Partial<LedgerState> & { error?: string; result?: unknown };
      if (!res.ok) {
        // Preserve entries; only replace verify with a concrete result, never a failed one.
        setLedger((s) => ({ ...s, entries: Array.isArray(data.entries) ? data.entries : s.entries, error: data.error ?? `${action} failed (HTTP ${res.status})` }));
        return;
      }
      setLedger((s) => ({
        ...s,
        entries: Array.isArray(data.entries) ? data.entries : s.entries,
        // Verify state only updates from a real verify response; tamper/restore clear the stale badge.
        verify: action === "verify" ? data.verify ?? s.verify : null,
        error: null,
      }));
    } catch (e) {
      setLedger((s) => ({ ...s, error: e instanceof Error ? e.message : `${action} failed` }));
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
        <VerdictBanner verdict={run.verdict} reason={run.reason} entryHash={run.entryHash} sealMatch={run.sealMatch} running={run.running} />
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
          error={ledger.error}
          demoMutable={ledger.demoMutable}
          onVerify={() => ledgerAction("verify")}
          onTamper={() => ledgerAction("tamper")}
          onRestore={() => ledgerAction("restore")}
        />
      </div>
    </div>
  );
}
