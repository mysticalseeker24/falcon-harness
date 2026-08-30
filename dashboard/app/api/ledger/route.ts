import { NextResponse } from "next/server";
import { demoMutableError, isDemoMutable, readLedger, restoreLedger, tamperLedger, verifyLedger } from "@/lib/attesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detailed diagnostics stay server-side; clients get a generic message + the current entries so the
// UI can keep the last-known ledger visible instead of blanking on failure.
function fail(op: string, err: unknown, status = 500) {
  console.error(`[ledger] ${op} failed:`, err instanceof Error ? err.stack ?? err.message : err);
  return NextResponse.json({ error: `${op} failed` }, { status });
}

export async function GET() {
  try {
    return NextResponse.json({ entries: await readLedger(), demoMutable: isDemoMutable() });
  } catch (err) {
    return fail("read ledger", err);
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "verify") {
    try {
      const verify = await verifyLedger(); // throws (bounded) if the verifier is unavailable
      return NextResponse.json({ verify, entries: await readLedger() });
    } catch (err) {
      return fail("verify", err);
    }
  }

  if (body.action === "tamper" || body.action === "restore") {
    const gate = demoMutableError();
    if (gate) {
      console.error(`[ledger] ${body.action} rejected: ${gate}`);
      return NextResponse.json({ error: gate }, { status: 403 }); // gate reason is safe, not a stack trace
    }
    try {
      const result = body.action === "tamper" ? await tamperLedger() : await restoreLedger();
      const ok = "tampered" in result ? result.tampered : result.restored;
      if (!ok) {
        // A refused demo op (e.g. "already tampered") is a 409, with its safe reason surfaced.
        return NextResponse.json({ error: result.reason ?? `${body.action} did not apply`, entries: await readLedger() }, { status: 409 });
      }
      return NextResponse.json({ result, entries: await readLedger() });
    } catch (err) {
      return fail(body.action, err);
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
