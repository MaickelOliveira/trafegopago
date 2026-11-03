import { postPublicWebhook } from "./public-webhook";
import { readDocument, writeDocument, withDataTransaction } from "./document-store";
import path from "path";
import { randomUUID } from "crypto";
import type { Lead } from "./leads";
import { updateLead, getLeads, getLeadById } from "./leads";
import { scheduleJob, claimDueJobs, markJobDone, markJobFailed, LEGACY_STEP_ID } from "./crm-automation-jobs";
import { sendMessage,sendMediaMessage,sendInteractiveList } from "./whatsapp-send";
import { getFunnelForConnection } from "./lead-context";
import { getFunnels } from "./funnels";
import { addMessage } from "./conversations";
import { getTemplates, sendTemplate } from "./waba-templates";
import type { TemplateComponent } from "./waba-templates";
import { currentHHMMBrasilia, todayISOBrasilia } from "./timezone";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Gatilhos disponíveis:
 * - lead_created     : Lead cadastrado via formulário/webhook
 * - column_changed   : Lead muda para qualquer coluna
 * - column_entered   : Lead criado OU movido para uma coluna específica
 * - scheduled_daily  : Diariamente às HH:MM para todos os leads de uma coluna
 * - message_received : Lead envia mensagem com palavra/frase específica
 */
export type CrmTrigger =
  | "lead_created"
  | "column_changed"
  | "column_entered"
  | "scheduled_daily"
  | "message_received";

export type CrmChannel = "evolution" | "waba";

/**
 * Tipos de passo de ação disponíveis:
 * - send_message  : Enviar mensagem de texto livre (Evolution ou API oficial)
 * - send_template : Enviar template aprovado (Meta WABA)
 * - send_list     : Enviar lista interativa WhatsApp (Evolution ou API oficial)
 * - add_note      : Adicionar nota/comentário ao lead no CRM
 * - move_column   : Mover lead para outra coluna do kanban
 * - delay         : Pausar N minutos antes do próximo passo
 * - webhook       : Chamar URL externa (HTTP POST com dados do lead)
 */
export type CrmStepType =
  | "send_message"
  | "send_template"
  | "send_list"
  | "add_note"
  | "move_column"
  | "delay"
  | "webhook";

export type ListRow = { id: string; title: string; description?: string };

export type CrmStep = {
  id: string;
  type: CrmStepType;
  // send_message / send_list:
  connectionId?: string;
  message?: string;
  imageUrl?: string;    // opcional: envia imagem + legenda (Evolution ou API oficial)
  // send_template:
  templateId?: string;
  templateVariables?: Record<string, string[]>;
  // send_list:
  listTitle?: string;
  listButtonText?: string;
  listRows?: ListRow[];
  // add_note:
  note?: string;
  // move_column:
  targetFunnelId?: string;
  targetColumnId?: string;
  // delay:
  delayMinutes?: number;
  // webhook:
  webhookUrl?: string;
  webhookBody?: string;
};

export type CrmAutomation = {
  id: string;
  clientId: string;
  funnelId?: string;          // se vazio, vale para qualquer funil do cliente
  name: string;
  active: boolean;
  trigger: CrmTrigger;
  triggerColumnId?: string;   // para column_changed / column_entered / scheduled_daily
  triggerWebhookId?: string;  // para lead_created: filtra por webhook específico (site)
  scheduledTime?: string;     // "HH:MM" para scheduled_daily
  triggerKeywords?: string[];  // para message_received: palavras/frases que ativam a automação
  // ── Multi-passo (novo) ──
  steps?: CrmStep[];
  // ── Legacy (single-action, mantido para retrocompatibilidade) ──
  channel?: CrmChannel;
  connectionId?: string;
  message?: string;
  templateId?: string;
  templateVariables?: Record<string, string[]>;
  delayMinutes?: number;
  createdAt: string;
  updatedAt: string;
};

// ── Storage ───────────────────────────────────────────────────────────────────

const FILE = path.join(process.cwd(), "data", "crm-automations.json");

async function load(): Promise<CrmAutomation[]> {
  return (await readDocument<CrmAutomation[]>("crm-automations.json", []));
}

async function save(list: CrmAutomation[]) {
  await writeDocument("crm-automations.json", list);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function getAutomations(clientId?: string): Promise<CrmAutomation[]> {
  const all = (await load());
  return clientId ? all.filter((a) => a.clientId === clientId) : all;
}

export async function getAutomationById(id: string): Promise<CrmAutomation | undefined> {
  return (await load()).find((a) => a.id === id);
}

export async function createAutomation(data: Omit<CrmAutomation, "id" | "createdAt" | "updatedAt">): Promise<CrmAutomation> {
  return withDataTransaction(async () => {
  const list = (await load());
  const now = new Date().toISOString();
  const automation: CrmAutomation = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
  list.push(automation);
  (await save(list));
  return automation;

  });
}

export async function updateAutomation(id: string, patch: Partial<CrmAutomation>): Promise<CrmAutomation | null> {
  return withDataTransaction(async () => {
  const list = (await load());
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id, updatedAt: new Date().toISOString() };
  (await save(list));
  return list[idx];

  });
}

export async function deleteAutomation(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const list = (await load());
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  (await save(next));
  return true;

  });
}

// ── Variable substitution ─────────────────────────────────────────────────────

function interpolate(text: string, lead: Lead, funnelName?: string): string {
  const firstName = (lead.name ?? "").split(" ")[0];
  const fullName  = lead.name ?? "";
  return text
    .replace(/\{\{nome\}\}/gi, firstName)
    .replace(/\{\{nome_completo\}\}/gi, fullName)
    .replace(/\{\{telefone\}\}/gi, lead.phone ?? "")
    .replace(/\{\{email\}\}/gi, lead.email ?? "")
    .replace(/\{\{funil\}\}/gi, funnelName ?? "");
}

function buildMetaComponents(
  tplComponents: TemplateComponent[],
  templateVariables: Record<string, string[]>,
  lead: Lead,
  funnelName?: string,
): object[] {
  const result: object[] = [];
  for (const comp of tplComponents) {
    const varMappings = templateVariables[comp.type];
    if (!varMappings || varMappings.length === 0) continue;
    const parameters = varMappings.map((mapping) => ({
      type: "text",
      text: interpolate(mapping, lead, funnelName),
    }));
    result.push({ type: comp.type.toLowerCase(), parameters });
  }
  return result;
}

/** Renderiza o texto do BODY do template com as variáveis ({{1}}, {{2}}...) substituídas. */
function renderTemplateText(
  tplComponents: TemplateComponent[],
  templateVariables: Record<string, string[]> | undefined,
  lead: Lead,
  funnelName?: string,
): string {
  const body = tplComponents.find((c) => c.type === "BODY");
  let text = body?.text ?? "";
  const varMappings = templateVariables?.BODY;
  if (varMappings) {
    varMappings.forEach((mapping, i) => {
      text = text.replace(`{{${i + 1}}}`, interpolate(mapping, lead, funnelName));
    });
  }
  return text;
}

// ── Step execution ────────────────────────────────────────────────────────────

type FunnelLike = { id: string; name: string; connections?: { id: string; metaPhoneNumberId?: string; metaToken?: string }[] };

function findConn(funnels: FunnelLike[], connId: string) {
  return funnels.flatMap((f) => f.connections ?? []).find((c) => c.id === connId);
}

async function executeStep(step: CrmStep, lead: Lead, funnels: FunnelLike[], funnelName?: string) {
  console.log(`[crm-auto] executeStep type=${step.type} stepId=${step.id} leadId=${lead.id} phone=${lead.phone} connId=${step.connectionId ?? "(none)"}`);
  switch (step.type) {
    case "send_message": {
      const connectionId=step.connectionId;
      if(!connectionId||!await getFunnelForConnection(lead.clientId,connectionId))throw Error("Conexão de envio desativada ou de outro cliente.");
      const msg=interpolate(step.message??"",lead,funnelName);
      if(step.imageUrl)await sendMediaMessage(lead.phone,step.imageUrl,lead.clientId,msg,connectionId);
      else if(!msg||!await sendMessage(lead.phone,msg,lead.clientId,connectionId))throw Error("O provedor não confirmou o envio.");
      await addMessage(lead.phone,{role:"assistant",content:msg||(step.imageUrl?"[imagem]":""),ts:Date.now(),...(step.imageUrl?{type:"image",mediaUrl:step.imageUrl}:{type:"text"})},lead.clientId,{connId:connectionId});
      break;
    }
    case "send_template": {
      const conn = findConn(funnels, step.connectionId ?? "");
      if (!step.templateId || !conn?.metaPhoneNumberId || !conn?.metaToken) throw Error("Conexão oficial incompleta.");
      const tpl = (await getTemplates(lead.clientId)).find((t) => t.id === step.templateId);
      if (!tpl || tpl.status !== "APPROVED" || tpl.phoneNumberId !== conn.metaPhoneNumberId) throw Error("Template não aprovado para esta conexão.");
      const comps = step.templateVariables
        ? buildMetaComponents(tpl.components, step.templateVariables, lead, funnelName)
        : [];
      const result = await sendTemplate(conn.metaPhoneNumberId, conn.metaToken, lead.phone, tpl.name, tpl.language,
        comps.length > 0 ? comps : undefined);

      if (!result.success) throw new Error("O provedor não confirmou o template.");
      if (result.success) {
        (await addMessage(lead.phone, {
          role: "assistant",
          content: renderTemplateText(tpl.components, step.templateVariables, lead, funnelName) || `[template: ${tpl.name}]`,
          ts: Date.now(),
          type: "text",
        }, lead.clientId, { connId: conn.id }));
      }
      break;
    }
    case "send_list": {
      if(!step.connectionId||!step.listTitle||!step.listRows?.length||!await sendInteractiveList(lead.phone,lead.clientId,step.connectionId,interpolate(step.listTitle,lead,funnelName),step.listButtonText||"Ver opções",step.listRows))throw Error("O provedor não confirmou a lista.");
      await addMessage(lead.phone,{role:"assistant",content:`${step.listTitle}\n${step.listRows.map(row=>row.title).join("\n")}`,ts:Date.now(),type:"text"},lead.clientId,{connId:step.connectionId});
      break;
    }
    case "add_note": {
      if (!step.note) return;
      const note = interpolate(step.note, lead, funnelName);
      const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const prev = lead.notes ?? "";
      (await updateLead(lead.id, { notes: prev + (prev ? "\n\n" : "") + `[${ts} — automação] ${note}` }));
      break;
    }
    case "move_column": {
      if (!step.targetColumnId) return;
      const target = (await getFunnels()).find(funnel => funnel.id === (step.targetFunnelId ?? lead.funnelId) && funnel.clientId === lead.clientId);
      if (!target?.columns.some(column => column.id === step.targetColumnId)) throw new Error("Etapa de destino inválida.");
      const patch: Partial<Lead> = { status: step.targetColumnId };
      if (step.targetFunnelId) patch.funnelId = step.targetFunnelId;
      (await updateLead(lead.id, patch));
      break;
    }
    case "delay":
      // Delays are handled at the scheduling level (see runAutomationsForEvent)
      break;
    case "webhook": {
      if (!step.webhookUrl) return;
      const body = step.webhookBody
        ? interpolate(step.webhookBody, lead, funnelName)
        : JSON.stringify({ id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, status: lead.status, funnelId: lead.funnelId });
      await postPublicWebhook(step.webhookUrl, body);
      break;
    }
  }
}

// ── Legacy execution (backward compat) ───────────────────────────────────────

async function executeLegacy(automation:CrmAutomation,lead:Lead){
 const funnels=(await getFunnels()).filter(funnel=>funnel.clientId===lead.clientId);
 await executeStep({id:"__legacy__",type:automation.channel==="waba"?"send_template":"send_message",connectionId:automation.connectionId,message:automation.message,templateId:automation.templateId,templateVariables:automation.templateVariables},lead,funnels,funnels.find(f=>f.id===lead.funnelId)?.name);
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function scheduleSteps(auto: CrmAutomation, lead: Lead) {
  await withDataTransaction(async () => {
    let delayMs = 0;
    if (auto.steps?.length) {
      for (const step of auto.steps) {
        if (step.type === "delay") {
          const minutes = step.delayMinutes ?? 1;
          if (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600) throw new Error("Intervalo inválido.");
          delayMs += minutes * 60_000;
        } else await scheduleJob(auto.id, lead.id, step.id, new Date(Date.now() + delayMs).toISOString());
      }
    } else {
      const minutes = auto.delayMinutes ?? 0;
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600) throw new Error("Intervalo inválido.");
      await scheduleJob(auto.id, lead.id, LEGACY_STEP_ID, new Date(Date.now() + minutes * 60_000).toISOString());
    }
  });
}

/**
 * Processa os jobs de automação (passos com delay) já vencidos — chamado pelo
 * cron (mesmo agendador dos follow-ups/batches), para que passos agendados
 * sobrevivam a restarts do servidor em vez de dependerem de um setTimeout vivo.
 */
export async function processDueCrmAutomationJobs(): Promise<{ processed: number; failed: number; total: number }> {
  const due = (await claimDueJobs());
  let processed = 0;
  let failed = 0;
  const allFunnels = (await getFunnels());

  for (const job of due) {
    try {
      const lead = (await getLeadById(job.leadId));
      const auto = (await getAutomationById(job.automationId));
      if (!lead || !auto || !auto.active || auto.clientId !== lead.clientId || auto.funnelId && auto.funnelId !== lead.funnelId) {
        (await markJobFailed(job.id, "lead ou automação não encontrados (removidos?)"));
        failed++;
        continue;
      }
      const funnel = allFunnels.find((f) => f.id === lead.funnelId);
      if (job.stepId === LEGACY_STEP_ID) {
        await executeLegacy(auto, lead);
      } else {
        const step = auto.steps?.find((s) => s.id === job.stepId);
        if (!step) {
          (await markJobFailed(job.id, "step não encontrado na automação (editada após o agendamento?)"));
          failed++;
          continue;
        }
        await executeStep(step, lead, allFunnels.filter(item => item.clientId === lead.clientId), funnel?.name);
      }
      (await markJobDone(job.id));
      processed++;
    } catch (e) {
      console.error(`[crm-auto] Erro ao processar job ${job.id}:`, e);
      (await markJobFailed(job.id, e instanceof Error ? e.message : String(e)));
      failed++;
    }
  }
  return { processed, failed, total: due.length };
}

/**
 * Dispara automações para um evento de CRM.
 */
export async function runAutomationsForEvent(
  trigger: CrmTrigger,
  lead: Lead,
  opts?: { toColumnId?: string; webhookId?: string },
) {
  const allForClient = (await getAutomations(lead.clientId));
  console.log(`[crm-auto] runAutomationsForEvent trigger=${trigger} leadId=${lead.id} phone=${lead.phone} funnelId=${lead.funnelId} toColumnId=${opts?.toColumnId ?? "(none)"} totalAutomations=${allForClient.length}`);
  const all = allForClient.filter((a) => {
    if (!a.active) { console.log(`[crm-auto] skip auto "${a.name}" (${a.id}): inactive`); return false; }
    if (a.trigger !== trigger) { console.log(`[crm-auto] skip auto "${a.name}": trigger mismatch (${a.trigger} != ${trigger})`); return false; }
    if (a.funnelId && a.funnelId !== lead.funnelId) { console.log(`[crm-auto] skip auto "${a.name}": funnelId mismatch (${a.funnelId} != ${lead.funnelId})`); return false; }
    if (trigger === "lead_created" && a.triggerWebhookId && a.triggerWebhookId !== opts?.webhookId) { console.log(`[crm-auto] skip auto "${a.name}": webhookId mismatch`); return false; }
    if (trigger === "column_changed" && a.triggerColumnId && a.triggerColumnId !== opts?.toColumnId) { console.log(`[crm-auto] skip auto "${a.name}": columnId mismatch (${a.triggerColumnId} != ${opts?.toColumnId})`); return false; }
    if (trigger === "column_entered" && a.triggerColumnId && a.triggerColumnId !== opts?.toColumnId) { console.log(`[crm-auto] skip auto "${a.name}": columnId mismatch (${a.triggerColumnId} != ${opts?.toColumnId})`); return false; }
    console.log(`[crm-auto] MATCH auto "${a.name}" (${a.id}) steps=${a.steps?.length ?? 0}`);
    return true;
  });
  console.log(`[crm-auto] matched ${all.length} automation(s) for trigger=${trigger}`);
  for (const auto of all) (await scheduleSteps(auto, lead));
}

/**
 * Dispara automações quando um lead envia uma mensagem com determinada palavra/frase.
 * Chamar no webhook de mensagens recebidas (WPPConnect / UazapiGO).
 */
export async function runAutomationsForMessage(clientId: string, lead: Lead, messageText: string) {
  const allForClient = (await getAutomations(clientId));
  const normalized = messageText.toLowerCase().trim();
  console.log(`[crm-auto] runAutomationsForMessage leadId=${lead.id} phone=${lead.phone} text="${normalized.slice(0, 80)}"`);
  const matched = allForClient.filter((a) => {
    if (!a.active) return false;
    if (a.trigger !== "message_received") return false;
    if (a.funnelId && a.funnelId !== lead.funnelId) return false;
    // Se não houver keywords definidas, qualquer mensagem dispara
    if (!a.triggerKeywords || a.triggerKeywords.length === 0) return true;
    return a.triggerKeywords.some((kw) => normalized.includes(kw.toLowerCase().trim()));
  });
  console.log(`[crm-auto] message_received matched ${matched.length} automation(s)`);
  for (const auto of matched) (await scheduleSteps(auto, lead));
}

/**
 * Dispara automações scheduled_daily.
 * Chamar via cron endpoint /api/cron/daily.
 * Dispara para todos os leads ativos nas colunas configuradas cujo scheduledTime == hora atual.
 */
export async function runScheduledDailyAutomations() {
  // Horário configurado pelo gestor é sempre pensado em Brasília — usar
  // getHours()/getMinutes() (hora local do processo Node) quebra o disparo se
  // o servidor rodar em UTC (comum em containers sem TZ configurado): o
  // horário nunca bate com o esperado, deslocado em 3h. Ver src/lib/timezone.ts.
  const currentTime = currentHHMMBrasilia();

  const all = (await getAutomations()).filter((a) => {
    if (!a.active) return false;
    if (a.trigger !== "scheduled_daily") return false;
    if (!a.scheduledTime) return false;
    // Match HH:MM (allow ±1min window)
    const [ah, am] = a.scheduledTime.split(":").map(Number);
    const [ch, cm] = currentTime.split(":").map(Number);
    return ah === ch && Math.abs(am - cm) <= 1;
  });

  for (const auto of all) {
    await withDataTransaction(async () => {
      const runs = await readDocument<Record<string, string>>("scheduler-runs.json", {});
      const today = todayISOBrasilia();
      const key = `daily:${auto.id}`;
      if (runs[key] === today) return;
      const leads = (await getLeads(auto.clientId)).filter(lead =>
        (!auto.funnelId || auto.funnelId === lead.funnelId) && (!auto.triggerColumnId || lead.status === auto.triggerColumnId),
      );
      for (const lead of leads) await scheduleSteps(auto, lead);
      runs[key] = today;
      await writeDocument("scheduler-runs.json", runs);
    });
  }
}
