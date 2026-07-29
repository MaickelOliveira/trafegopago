// Duas tarefas agendadas do "Agente IA", chamadas a cada tick do cron
// (instrumentation.ts a cada 60s, e /api/agent/cron externamente) — mesmo
// padrão de runScheduledDailyAutomations() em crm-automations.ts.
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getClients, getAllAgentConfigs, upsertAgentConfigForConnection } from "./clients";
import { getLeads, getLeadByPhone, updateLead } from "./leads";
import { getAllConversationsByClientId, getHistory, setAiPaused } from "./conversations";
import { sendMessage, getGeminiApiKey } from "./whatsapp-send";
import { currentHHMMBrasilia, todayISOBrasilia, startOfTodayBrasiliaMs, dateISOBrasilia } from "./timezone";

type ConversaResumo = { phone: string; connId: string | null; nome: string; status: string };

// Resume TODAS as conversas do dia numa ÚNICA chamada Gemini (não uma por
// conversa) — um resumo curto e descritivo ("cobrando pagamento atrasado")
// em vez de só repetir a última mensagem crua, que muitas vezes não diz nada
// sozinha ("Esse", "Oi", "[Imagem]"). Se a chamada falhar por qualquer motivo,
// cai no preview cru da última mensagem (nunca deixa o resumo sem nada).
async function resumirConversasComIA(
  apiKey: string,
  conversas: ConversaResumo[],
  clientId: string,
): Promise<Map<string, string>> {
  const resumos = new Map<string, string>();
  if (!conversas.length) return resumos;

  const blocos = conversas.map((c, i) => {
    const msgs = getHistory(c.phone, clientId, c.connId ?? undefined).slice(-4);
    const texto = msgs
      .map((m) => `${m.role === "user" ? "Cliente" : "Atendimento"}: ${m.content.slice(0, 200).replace(/\n/g, " ")}`)
      .join("\n") || "(sem mensagens)";
    return `${i + 1}. ${c.nome}:\n${texto}`;
  });

  const prompt = `Você resume conversas de atendimento por WhatsApp pra um gestor bater o olho rapidamente no que aconteceu no dia.

Para cada conversa numerada abaixo, escreva um resumo BEM CURTO (máximo 10-12 palavras) descrevendo a SITUAÇÃO — nunca copie a última mensagem literal, descreva o que está acontecendo ou o que a pessoa quer.

Exemplos de bom resumo: "cobrando pagamento atrasado", "pediu pra ligar, achou mais fácil", "mandou comprovante de pagamento", "dúvida sobre previsão de rescisão", "só cumprimentou, sem pedido claro".

Conversas:
${blocos.join("\n\n")}

Retorne SOMENTE um array JSON de strings, na MESMA ORDEM E QUANTIDADE acima, sem markdown:
["resumo 1", "resumo 2", ...]`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      conversas.forEach((c, i) => {
        if (typeof arr[i] === "string" && arr[i].trim()) resumos.set(c.phone, arr[i].trim());
      });
    }
  } catch (e) {
    console.warn("[daily-summary] erro ao resumir conversas com IA — caindo no preview cru:", e instanceof Error ? e.message : e);
  }
  return resumos;
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
  const today = todayISOBrasilia();
  const nowHHMM = currentHHMMBrasilia();

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
        .filter((c) => dateISOBrasilia(c.lastActivity) === today)
        .sort((a, b) => b.lastActivity - a.lastActivity);

      if (conversas.length > 0) {
        const comNome = conversas.map((c) => {
          const lead = getLeadByPhone(client.id, c.phone);
          const nome = lead?.name && lead.name !== c.phone ? lead.name : c.phone;
          const status = c.aiPaused ? "🙋 com atendente" : "🤖 com a IA";
          return { phone: c.phone, connId: c.connId, nome, status, lastMessage: c.lastMessage };
        });

        const apiKey = getGeminiApiKey(cfg.geminiApiKey);
        const resumosIA = apiKey ? await resumirConversasComIA(apiKey, comNome, client.id) : new Map<string, string>();

        const linhas = comNome.map((c) => {
          const preview = resumosIA.get(c.phone) ?? (c.lastMessage?.content ?? "").slice(0, 100).replace(/\n/g, " ");
          return `• *${c.nome}* (${c.phone}) — ${c.status}\n  ${preview}`;
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
  const startOfTodayMs = startOfTodayBrasiliaMs();

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
