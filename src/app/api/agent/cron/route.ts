import { NextRequest, NextResponse } from "next/server";
import { getDueFollowUps, markSent, scheduleFollowUp } from "@/lib/followups";
import { getClientById, getConfig } from "@/lib/clients";
import { sendMessage } from "@/lib/whatsapp-send";

// GET /api/agent/cron?secret=xxx
// Chamado pelo EasyPanel a cada 15 min para processar follow-ups vencidos
export async function GET(req: NextRequest) {
  const { agentCronSecret } = getConfig();
  const secret = req.nextUrl.searchParams.get("secret");

  if (agentCronSecret && secret !== agentCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = getDueFollowUps();
  let processed = 0;
  let skipped = 0;

  for (const followUp of due) {
    const client = getClientById(followUp.clientId);

    // Pula se o cliente desabilitou follow-ups
    if (client?.agentConfig?.followUpEnabled === false) {
      skipped++;
      continue;
    }

    try {
      await sendMessage(followUp.phone, followUp.message, followUp.clientId);
      markSent(followUp.id);
      processed++;
      console.log(`[agent/cron] Follow-up enviado: ${followUp.id} → ${followUp.phone}`);

      // Agenda o próximo step da sequência, se houver
      const steps = client?.agentConfig?.followUps ?? [];
      const nextIdx = (followUp.stepIndex ?? 0) + 1;
      const nextStep = steps[nextIdx];
      if (nextStep && client?.agentConfig?.followUpEnabled === true) {
        const scheduledAt = new Date(Date.now() + nextStep.delayHours * 3600000).toISOString();
        scheduleFollowUp({
          clientId: followUp.clientId,
          phone: followUp.phone,
          scheduledAt,
          message: nextStep.message,
          type: "followup",
          stepIndex: nextIdx,
          stepId: nextStep.id,
        });
        console.log(`[agent/cron] Próximo step ${nextIdx} agendado para ${scheduledAt}`);
      }
    } catch (e) {
      console.error(`[agent/cron] Erro ao enviar ${followUp.id}:`, e);
    }
  }

  return NextResponse.json({ ok: true, processed, skipped, total: due.length });
}
