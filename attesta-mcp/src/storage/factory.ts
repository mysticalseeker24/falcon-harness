import { LocalArtifactStore, LocalLedgerStore } from "./local.js";
import type { ArtifactStore, LedgerStore } from "./types.js";

export interface Stores {
  ledger: LedgerStore;
  artifacts: ArtifactStore;
}

// The local filesystem backend is the tested, working path and needs no external infra. The
// deployed demo swaps in Postgres (ledger) + Cloudflare R2 (artifacts) adapters behind the same
// interfaces when DATABASE_URL / R2_* are configured — added in a follow-up; not wired here so no
// unverified path is presented as working (CONVENTIONS §8).
export function getStorePaths(): { ledgerPath: string; artifactDir: string } {
  return {
    ledgerPath: process.env.ATTESTA_LEDGER_PATH ?? "./data/ledger.jsonl",
    artifactDir: process.env.ATTESTA_ARTIFACT_DIR ?? "./data/artifacts",
  };
}

export function getStores(): Stores {
  const { ledgerPath, artifactDir } = getStorePaths();
  return {
    ledger: new LocalLedgerStore(ledgerPath),
    artifacts: new LocalArtifactStore(artifactDir),
  };
}
