// Duas tarefas agendadas do "Agente IA", chamadas a cada tick do cron
// (instrumentation.ts a cada 60s, e /api/agent/cron externamente) — mesmo
// padrão de runScheduledDailyAutomations() em crm-automations.ts.
import { getClients, getAllAgentConfigs, upsertAgentConfigForConnection } from "./clients";
import { getLeads, getLeadByPhone, updateLead } from "./leads";
import { getAllConversationsByClientId, setAiPaused } from "./conversations";
import { sendMessage } from "./whatsapp-send";

function currentHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Mesma janela de tolerância (±1min) usada em runScheduledDailyAutomations —
// o tick roda a cada 60s, então o horário exato pode cair entre dois ticks.
function timeMatches(configured: string, current: string): boolean {
  const [ch, cm] = configured.split(":").map(Number);
  const [nh, nm] = current.split(":").map(Number);
  if (Number.isNaN(ch) || Number.isNaN(cm)) return false;
  return ch === nh && Math.abs(cm - nm) <= 1;
}

/**
 * Resumo diário — só roda se dailySummaryEnabled=true nesse AgentConfig.
 * Envia pra avisos[] (mesmos destinatários do enviar_resumo) um resumo de
 * todas as conversas do dia NESSA conexão, no horário configurado.
 */
export async function runDailySummaries(): Promise<number> {
  let sent = 0;
  const today = todayISO();
  const nowHHMM = currentHHMM();

  for (const client of getClients()) {
    for (const cfg of getAllAgentConfigs(client)) {
      if (!cfg.dailySummaryEnabled || !cfg.dailySummaryTime) continue;
      if (cfg.dailySummaryLastSentDate === today) continue;
      if (!timeMatches(cfg.dailySummaryTime, nowHHMM)) continue;

      const recipients = cfg.avisos?.length
        ? cfg.avisos
        : cfg.summaryPhone
          ? [{ id: "legacy", label: "Gestor", value: cfg.summaryPhone, type: "phone" as const }]
          : [];
      if (recipients.length === 0) {
        console.warn(`[daily-summary] cliente=${client.id} sem destinatários (avisos/summaryPhone) — pulando`);
        continue;
      }

      const connId = cfg.whatsappConnectionId;
      const conversas = getAllConversationsByClientId(client.id)
        .filter((c) => (connId ? c.connId === connId : true))
        .filter((c) => new Date(c.lastActivity).toISOString().slice(0, 10) === today)
        .sort((a, b) => b.lastActivity - a.lastActivity);

      if (conversas.length > 0) {
        const linhas = conversas.map((c) => {
          const lead = getLeadByPhone(client.id, c.phone);
          const nome = lead?.name && lead.name !== c.phone ? lead.name : c.phone;
          const preview = (c.lastMessage?.content ?? "").slice(0, 100).replace(/\n/g, " ");
          const status = c.aiPaused ? "🙋 com atendente" : "🤖 com a IA";
          return `• *${nome}* (${c.phone}) — ${status}\n  "${preview}"`;
        });
        const msg = `📋 *Resumo do dia — ${client.name}*\n\n${conversas.length} conversa(s) hoje:\n\n${linhas.join("\n\n")}`;

        for (const r of recipients) {
          await sendMessage(r.value, msg, client.id, connId).catch((e) =>
            console.error(`[daily-summary] erro ao enviar pra ${r.label}:`, e)
          );
        }
        sent++;
        console.log(`[daily-summary] enviado — cliente=${client.id} connId=${connId ?? "default"} conversas=${conversas.length}`);
      } else {
        console.log(`[daily-summary] sem conversas hoje — cliente=${client.id} connId=${connId ?? "default"}, marcando como enviado mesmo assim`);
      }

      // Marca como enviado hoje mesmo sem conversas — evita ficar checando de novo
      // a cada tick pelo resto do dia (só volta a valer amanhã).
      upsertAgentConfigForConnection(client, connId, { ...cfg, dailySummaryLastSentDate: today });
    }
  }
  return sent;
}

/**
 * Reativação automática da IA — só roda se aiAutoResumeEnabled=true. Sem essa
 * marcação, um lead pausado continua pausado até reativação manual (pelo
 * gestor ou pela palavra-chave de retomada) — nada muda pra quem não ligou a opção.
 */
export function reativarIaAutomaticamente(): number {
  let count = 0;
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  for (const client of getClients()) {
    const activeCfg = getAllAgentConfigs(client).find((c) => c.aiAutoResumeEnabled);
    if (!activeCfg) continue;

    // Leads pausados ANTES dessa função existir nunca tiveram aiPausedAt
    // carimbado (o carimbo só acontece na transição aiPaused:false→true em
    // updateLead/upsertLeadByPhone) — exigir aiPausedAt aqui os deixava
    // pausados pra sempre, nunca elegíveis pra reativação automática.
    const leadsPausados = getLeads(client.id).filter((l) => l.aiPaused);
    for (const lead of leadsPausados) {
      if (!lead.aiPausedAt) {
        // Carimba agora em vez de assumir "pausado há muito tempo" — evita
        // reativar de uma hora pra outra vários leads antigos que um
        // atendente ainda pode estar tratando; a partir daqui passam a
        // contar normalmente pro modo configurado (duração ou meia-noite).
        updateLead(lead.id, { aiPausedAt: new Date().toISOString() });
        continue;
      }
      const pausedAtMs = new Date(lead.aiPausedAt).getTime();
      const shouldResume = activeCfg.aiAutoResumeMode === "midnight"
        ? pausedAtMs < startOfTodayMs // reseta tudo que ficou pausado de um dia pro outro
        : (now - pausedAtMs) >= (activeCfg.aiAutoResumeHours ?? 24) * 3600000;

      if (shouldResume) {
        updateLead(lead.id, { aiPaused: false });
        setAiPaused(lead.phone, false, client.id);
        count++;
        console.log(`[ai-auto-resume] reativado — cliente=${client.id} lead=${lead.id} phone=${lead.phone}`);
      }
    }
  }
  return count;
}
