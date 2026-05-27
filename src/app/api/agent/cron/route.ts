import { NextRequest, NextResponse } from "next/server";
import { getDueFollowUps, markSent, scheduleFollowUp } from "@/lib/followups";
import { getDuePending, markProcessing, markDone } from "@/lib/pending-responses";
import { getClientById, getConfig } from "@/lib/clients";
import { sendMessage } from "@/lib/whatsapp-send";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { addMessage, getHistory } from "@/lib/conversations";
import { runScheduledDailyAutomations } from "@/lib/crm-automations";

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

  // ── Processa batches de mensagens vencidos ───────────────────────────────
  const pendingBatches = getDuePending();
  let batchesProcessed = 0;

  for (const batch of pendingBatches) {
    const client = getClientById(batch.clientId);
    if (!client?.agentConfig?.enabled) continue;

    try {
      markProcessing(batch.id);
      const combined = batch.messages.join("\n");
      const history = getHistory(batch.phone);
      const { text: reply } = await runGeminiAgent(combined, history, batch.clientId, batch.phone);
      markDone(batch.id);

      if (reply) {
        addMessage(batch.phone, { role: "assistant", content: reply, ts: Date.now() }, batch.clientId);
        await sendMessage(
          batch.phone, reply, batch.clientId,
          client.agentConfig.whatsappConnectionId
        );
        batchesProcessed++;
      }
    } catch (e) {
      console.error(`[agent/cron] Erro ao processar batch ${batch.id}:`, e);
      markDone(batch.id);
    }
  }

  // ── Automações CRM agendadas (scheduled_daily) ───────────────────────────
  runScheduledDailyAutomations();

  return NextResponse.json({ ok: true, processed, skipped, total: due.length, batchesProcessed });
}
