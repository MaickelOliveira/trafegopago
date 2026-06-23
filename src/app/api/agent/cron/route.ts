import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/clients";
import { processDueFollowUpsAndBatches } from "@/lib/cron-tasks";

// GET /api/agent/cron?secret=xxx
// Endpoint HTTP equivalente ao agendador interno (instrumentation.ts, a cada
// 60s) — útil para acionar manualmente (testes) ou como gatilho externo
// redundante (ex: EasyPanel). Ambos chamam a mesma lógica em cron-tasks.ts.
export async function GET(req: NextRequest) {
  const { agentCronSecret } = getConfig();
  const secret = req.nextUrl.searchParams.get("secret");

  if (agentCronSecret && secret !== agentCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueFollowUpsAndBatches();
  return NextResponse.json({ ok: true, ...result });
}
