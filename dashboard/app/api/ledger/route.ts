import { NextResponse } from "next/server";
import { readLedger, restoreLedger, tamperLedger, verifyLedger } from "@/lib/attesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await readLedger();
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (body.action === "verify") {
      const verify = await verifyLedger();
      return NextResponse.json({ verify, entries: await readLedger() });
    }
    if (body.action === "tamper") {
      await tamperLedger();
      return NextResponse.json({ entries: await readLedger() });
    }
    if (body.action === "restore") {
      await restoreLedger();
      return NextResponse.json({ entries: await readLedger() });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ledger op failed" }, { status: 500 });
  }
}
