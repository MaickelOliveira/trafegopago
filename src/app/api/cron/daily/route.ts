import { authorizeCron } from "@/lib/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledDailyAutomations } from "@/lib/crm-automations";

export const dynamic = "force-dynamic";

/**
 * Endpoint para disparar automações agendadas (scheduled_daily).
 * Chame via n8n — Schedule Trigger + HTTP Request:
 *   GET https://trafegopago-trafegopago.ztcjzs.easypanel.host/api/cron/daily
 *   Header: x-cron-secret: <CRON_SECRET>  (obrigatório)
 *
 * Configurar a cada 1 minuto no n8n para que nenhum horário seja perdido.
 */
async function handle(req: NextRequest) {
  if (!await authorizeCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  (await runScheduledDailyAutomations());
  return NextResponse.json({ ok: true, firedAt: new Date().toISOString() });
}

export async function GET(req: NextRequest) { return (await handle(req)); }
export async function POST(req: NextRequest) { return (await handle(req)); }
