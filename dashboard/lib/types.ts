export type Verdict = "EXPLOITED" | "CLEAN" | "INCONCLUSIVE";
export type StepStatus = "pending" | "active" | "done" | "error";

export interface RunStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  mono?: boolean;
  at?: number; // ms elapsed when it completed
}

export interface Exchange {
  method: string;
  url: string;
  reqHeaders: Record<string, string>;
  reqBody: unknown;
  status: number;
  resHeaders: Record<string, string>;
  resBody: unknown;
}

export interface RunState {
  target: { repo: string; pr: number; branch: string };
  writerModel: string;
  auditorModel: string;
  steps: RunStep[];
  evidence: Exchange | null;
  verdict: Verdict | null;
  reason: string | null;
  entryHash: string | null;
  auditorOk: boolean | null;
  approval: { required: boolean; resolved: "approved" | "rejected" | null };
  running: boolean;
}

export interface LedgerEntryView {
  id: string;
  verdict: string;
  route: string | null;
  pr_number: number | null;
  auditor_model: string | null;
  entry_hash: string;
  prev_hash: string;
  ts: string;
}
export interface VerifyResult {
  valid: boolean;
  length: number;
  broken_at: string | null;
}
export interface LedgerState {
  entries: LedgerEntryView[];
  verify: VerifyResult | null;
}
