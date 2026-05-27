import { NextRequest, NextResponse } from "next/server";
import { runScheduledDailyAutomations } from "@/lib/crm-automations";

export const dynamic = "force-dynamic";

/**
 * Endpoint para disparar automações agendadas (scheduled_daily).
 * Configure um cron job no EasyPanel ou n8n para chamar:
 *   POST /api/cron/daily
 *   Header: x-cron-secret: <CRON_SECRET>
 *
 * Chame a cada 1 minuto para garantir que nenhum horário seja perdido.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  runScheduledDailyAutomations();
  return NextResponse.json({ ok: true, firedAt: new Date().toISOString() });
}

export async function GET(req: NextRequest) {
  // Allow GET for easy testing (without secret in dev)
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Use POST" }, { status: 405 });
  }
  runScheduledDailyAutomations();
  return NextResponse.json({ ok: true, firedAt: new Date().toISOString() });
}
