import { readRecordList, writeRecordList, type RecordFilter } from "./record-store";
import { withDataTransaction } from "./document-store";
import path from "path";
import { randomUUID } from "crypto";
import { getAllConversationsByClientId } from "./conversations";
import { getFunnelById } from "./funnels";
import { getClientById } from "./clients";
import { sendCapiEvent } from "./meta-capi";

export type LeadStatus = "novo" | "contato" | "proposta" | "ganho" | "perdido";
export type LeadSource = "whatsapp" | "form" | "manual";
export type AdPlatform = "meta" | "google" | null;
export class LeadIdentityConflict extends Error {}

export type LeadAI = {
  summary: string;
  score: number; // 1-10
  nextStep: string;
  generatedAt: string;
};

export type LeadReminder = {
  id: string;
  title: string;     // ex: "Ligar de volta"
  dueDate: string;   // ISO datetime
  note?: string;
  done?: boolean;
  createdAt: string;
};

export type Lead = {
  id: string;
  clientId: string;
  funnelId: string;
  name: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  adPlatform?: AdPlatform;     // "meta" | "google" | null
  campaignName: string | null;
  campaignId?: string | null;  // ID da campanha (Meta/Google)
  adSetName?: string | null;   // Nome do conjunto de anúncios
  adSetId?: string | null;     // ID do conjunto de anúncios
  adName?: string | null;      // Nome do anúncio
  adId?: string | null;        // ID do anúncio (Meta ad_id / Google creative)
  adSourceUrl?: string | null; // Link do anúncio (referral.source_url do CTWa)
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  gclid: string | null;
  fbp?: string | null;              // Cookie _fbp do navegador (Meta CAPI — sobe a qualidade de correspondência)
  clientIp?: string | null;         // IP real do navegador no momento da captura do lead (Meta CAPI)
  clientUserAgent?: string | null;  // User-Agent real do navegador no momento da captura do lead (Meta CAPI)
  value: number | null;
  status: string; // coluna do funil (dinâmica)
  notes: string;
  ai: LeadAI | null;
  aiPaused?: boolean; // IA pausada para esta conversa (especialista assumiu)
  aiPausedAt?: string | null; // timestamp de quando aiPaused virou true — usado pela reativação automática (ver reativarIaAutomaticamente em cron-tasks.ts)
  followUpDisabled?: boolean; // Follow-up automático desativado só para este lead
  isLid?: boolean;    // Contato usa LID interno do WhatsApp (novo protocolo) — envia com isLid:true
  realPhone?: string; // Número real resolvido do contato LID (para exibição)
  customFields?: Record<string, string>; // Campos extras do formulário de origem
  reminders?: LeadReminder[]; // Lembretes agendados para este lead
  needsAttention?: boolean;        // IA pediu ajuda humana (resumo_solicitado) e ainda não foi resolvido
  needsAttentionReason?: string;   // motivo informado pela IA
  needsAttentionAt?: string;       // ISO timestamp de quando foi marcado
  createdAt: string;
  updatedAt: string;
  heat?: "cold" | "stalled" | "hot"; // calculado em tempo de leitura a partir da conversa — não é salvo em disco
};

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "leads.json");
const BAK  = FILE + ".bak";
const TMP  = FILE + ".tmp";


const load = (filter?: RecordFilter) => readRecordList<Lead>("leads.json", filter);

const save = (leads: Lead[], previous: Lead[] = leads) => writeRecordList("leads.json", leads, previous);

export async function getLeads(clientId?: string): Promise<Lead[]> {
  const all = (await load(clientId ? { clientId } : {}));
  return clientId ? all.filter((l) => l.clientId === clientId) : all;
}

// Silêncio >= 6h conta como "parada" — abaixo disso a conversa está "fluindo".
const HOURS_STALLED = 6;
// Até 2 mensagens é só um "oi" inicial (ou resposta automática) — não é troca real.
const MIN_MESSAGES_FOR_REAL_ENGAGEMENT = 3;

function computeHeat(messageCount: number, lastActivity: number): Lead["heat"] {
  // Poucas mensagens = ainda não teve troca real, não importa a hora —
  // nunca é "fluindo" só por ter chegado uma mensagem agora há pouco.
  if (messageCount < MIN_MESSAGES_FOR_REAL_ENGAGEMENT) return "cold";
  const hoursSince = (Date.now() - lastActivity) / 3_600_000;
  return hoursSince < HOURS_STALLED ? "hot" : "stalled";
}

/**
 * Calcula o campo `heat` (calor da conversa, no card do CRM) a partir do
 * histórico real de mensagens e devolve cópias novas dos leads — nunca muta
 * os objetos originais, que vêm do cache em memória de getLeads() e poderiam
 * acabar persistidos em disco caso outro código salve o array depois.
 */
export async function attachLeadsHeat(leads: Lead[]): Promise<Lead[]> {
  const heatByLeadId = new Map<string, Lead["heat"]>();
  const leadsByClient = new Map<string, Lead[]>();
  for (const lead of leads) {
    const group = leadsByClient.get(lead.clientId) ?? [];
    group.push(lead);
    leadsByClient.set(lead.clientId, group);
  }
  for (const [clientId, clientLeads] of leadsByClient) {
    const conversations = (await getAllConversationsByClientId(clientId));
    const { getFunnelForConnection } = await import("./lead-context");
    const connectionFunnels = new Map(await Promise.all([...new Set(conversations.map(conversation => conversation.connId).filter((id): id is string => !!id))].map(async id => [id,(await getFunnelForConnection(clientId,id))?.id] as const)));
    const byPhone = new Map<string,(typeof conversations)[number]>();
    for (const conversation of conversations) {
      const funnelId = conversation.connId ? connectionFunnels.get(conversation.connId) : undefined;
      if (!funnelId) continue;
      const key = `${funnelId}:${normalizePhone(conversation.phone)}`;
      const current = byPhone.get(key);
      if (!current || conversation.lastActivity > current.lastActivity) byPhone.set(key,conversation);
    }
    for (const lead of clientLeads) {
      const conv = byPhone.get(`${lead.funnelId}:${normalizePhone(lead.realPhone || lead.phone)}`);
      if (conv) heatByLeadId.set(lead.id, computeHeat(conv.messageCount, conv.lastActivity));
    }
  }
  return leads.map((lead) => heatByLeadId.has(lead.id) ? { ...lead, heat: heatByLeadId.get(lead.id) } : lead);
}

export async function getLeadById(id: string): Promise<Lead | undefined> {
  return (await load({ id })).find((l) => l.id === id);
}

/** Marca um lead como precisando de atenção humana — chamado quando a IA dispara resumo_solicitado */
export async function markLeadNeedsAttention(clientId: string, phone: string, funnelId: string | undefined, motivo: string): Promise<void> {
  const lead = (await getLeadByPhone(clientId, phone, funnelId));
  if (!lead) return;
  (await updateLead(lead.id, { needsAttention: true, needsAttentionReason: motivo, needsAttentionAt: new Date().toISOString() }));
}

export async function getLeadByPhone(clientId: string, phone: string, funnelId?: string): Promise<Lead | undefined> {
  const normalized = normalizePhone(phone);
  const matches = (await load({ clientId, phone, ...(funnelId ? { funnelId } : {}) })).filter(
    (l) =>
      l.clientId === clientId &&
      (!funnelId || l.funnelId === funnelId) &&
      (normalizePhone(l.phone) === normalized ||
        (l.realPhone != null && normalizePhone(l.realPhone) === normalized)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export async function hasLeadByPhone(clientId: string, phone: string, funnelId?: string): Promise<boolean> {
  const normalized=normalizePhone(phone);
  return (await load({clientId,phone,...(funnelId?{funnelId}:{})})).some(lead=>lead.clientId===clientId&&(!funnelId||lead.funnelId===funnelId)&&[lead.phone,lead.realPhone].some(value=>value&&normalizePhone(value)===normalized));
}

/**
 * Dispara o evento CAPI configurado na coluna em que o lead entrou — cobre o
 * caso de o lead já nascer direto na coluna (webhook, WhatsApp, etc.), sem
 * passar por uma mudança de status via PUT (único lugar que disparava isso
 * antes, então lead novo criado já na coluna "Novo" nunca gerava o evento).
 */
async function fireEntryColumnMetaEvent(lead: Lead): Promise<void> {
  const funnel = (await getFunnelById(lead.funnelId));
  const col = funnel?.columns.find((c) => c.id === lead.status);
  if (!col?.metaEvent) return;
  const client = (await getClientById(lead.clientId));
  if (!client?.pixelId) return;
  sendCapiEvent({
    pixelId: client.pixelId,
    capiToken: client.capiToken,
    testEventCode: client.capiTestEventCode || undefined,
    eventName: col.metaEvent,
    phone: lead.phone,
    email: lead.email ?? undefined,
    name: lead.name,
    fbclid: lead.fbclid ?? undefined,
    fbp: lead.fbp ?? undefined,
    clientIp: lead.clientIp ?? undefined,
    clientUserAgent: lead.clientUserAgent ?? undefined,
    externalId: lead.id,
  }).catch((e) => console.error("[Meta CAPI] evento da coluna de entrada", e));
}

export async function createLead(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): Promise<Lead> {
  return withDataTransaction(async () => {
  const leads = (await load({ clientId: data.clientId, phone: data.phone, funnelId: data.funnelId }));
  // Evita duplicata por telefone + cliente + funil (checa também realPhone)
  const normalizedNew = normalizePhone(data.phone);
  const existing = leads.filter(
    (l) =>
      l.clientId === data.clientId &&
      l.funnelId === data.funnelId &&
      (normalizePhone(l.phone) === normalizedNew ||
        (l.realPhone != null && normalizePhone(l.realPhone) === normalizedNew)),
  );
  if (existing.length > 1) throw new LeadIdentityConflict("Identidade de contato duplicada neste funil. Revise o cadastro antes de automatizar.");
  if (existing.length === 1) return existing[0];

  const now = new Date().toISOString();
  const lead: Lead = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
  leads.push(lead);
  (await save(leads));
  (await fireEntryColumnMetaEvent(lead));
  return lead;

  });
}

export async function updateLead(id: string, patch: Partial<Omit<Lead, "id" | "createdAt">>): Promise<Lead | null> {
  return withDataTransaction(async () => {
  const leads = (await load({ id }));
  const idx = leads.findIndex((l) => l.id === id);
  if (idx < 0) return null;
  // Normaliza phone/realPhone quando presentes no patch (ex: edição manual no CRM)
  // — sem isso, um telefone salvo sem o 9º dígito nunca mais bate com
  // normalizePhone(l.phone) nas buscas de outras funções, criando duplicatas.
  const previous = { ...leads[idx] };
  const normalizedPatch = { ...patch };
  if (normalizedPatch.phone) normalizedPatch.phone = normalizePhone(normalizedPatch.phone);
  if (normalizedPatch.realPhone) normalizedPatch.realPhone = normalizePhone(normalizedPatch.realPhone);
  // Carimba (ou limpa) aiPausedAt centralizado aqui — usado pela reativação
  // automática da IA (cron-tasks.ts) pra saber há quanto tempo está pausada,
  // sem precisar duplicar essa lógica em cada chamador que pausa/retoma a IA.
  if (normalizedPatch.aiPaused === true) normalizedPatch.aiPausedAt = new Date().toISOString();
  else if (normalizedPatch.aiPaused === false) normalizedPatch.aiPausedAt = null;
  leads[idx] = { ...leads[idx], ...normalizedPatch, id: leads[idx].id, clientId: leads[idx].clientId, createdAt: leads[idx].createdAt, updatedAt: new Date().toISOString() };
  (await save(leads));
  if (patch.status !== undefined || patch.aiPaused !== undefined || patch.followUpDisabled !== undefined) {
    const { synchronizeLeadWorkflows } = await import("./lead-workflows");
    await synchronizeLeadWorkflows(leads[idx], previous);
  }
  return leads[idx];

  });
}

export async function deleteLead(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const leads = (await load({ id }));
  const filtered = leads.filter((l) => l.id !== id);
  if (filtered.length === leads.length) return false;
  (await save(filtered, leads));
  return true;

  });
}

/**
 * Normaliza qualquer formato de telefone BR para comparação.
 * Aceita: (44) 9 9884-1285 | 44998841285 | 5544998841285 | 554498841285 etc.
 * 1. Remove não-dígitos
 * 2. Strip código do país BR (55) se sobrar ≥ 10 dígitos
 * 3. Migração do 9º dígito: número com 10 dígitos onde o 3º dígito é 6-9
 *    (celular em formato antigo) recebe o 9 após o DDD → 11 dígitos
 */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  // Remove código do país Brasil
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // Migração 9º dígito BR: DDD(2) + celular antigo(8 dígitos começando com 6-9)
  if (d.length === 10 && /^[1-9]{2}[6-9]/.test(d)) {
    d = d.slice(0, 2) + "9" + d.slice(2);
  }
  return d;
}

/**
 * Mesma correção de normalizePhone(), mas mantendo o DDI 55 — usar quando o
 * número precisa ficar no formato discável/wa.me (ex: links de notificação).
 * A API oficial da Meta às vezes manda o wa_id do webhook sem o 9º dígito
 * (ex: 554498168355 em vez de 5544998168355), o que quebra o link wa.me/.
 */
export function toDialablePhone(raw: string): string {
  return "55" + normalizePhone(raw);
}

export async function upsertLeadByPhone(clientId: string, phone: string, patch: Partial<Lead>): Promise<Lead> {
  return withDataTransaction(async () => {
  const leads = (await load({ clientId, phone, funnelId: patch.funnelId ?? "default" }));
  patch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  delete patch.id; delete patch.clientId; delete patch.phone;
  const normalized = normalizePhone(phone);
  const funnelId = patch.funnelId ?? "default";
  // Normaliza ANTES de ramificar create/update — senão um lead novo (que lê
  // patch.realPhone direto no literal abaixo) e um lead existente (que só dá
  // spread no patch) guardariam o número real em formatos diferentes.
  if (patch.realPhone) patch = { ...patch, realPhone: normalizePhone(patch.realPhone) };
  // Busca por clientId + funnelId + telefone normalizado.
  // Mesmo número em funnels diferentes = leads separados (cada agente/canal tem seu próprio lead).
  // Mesmo número no mesmo funil = um único lead (sem duplicata).
  const candidates = leads.filter(
    (l) =>
      l.clientId === clientId &&
      l.funnelId === funnelId &&
      (normalizePhone(l.phone) === normalized ||
        (l.realPhone != null && normalizePhone(l.realPhone) === normalized)),
  );
  if (candidates.length > 1) throw new LeadIdentityConflict("Identidade de contato duplicada neste funil. Revise o cadastro antes de automatizar.");
  const idx = candidates.length ? leads.indexOf(candidates[0]) : -1;
  const now = new Date().toISOString();
  if (idx >= 0) {
    // Missing automatic metadata must not erase manually edited or captured data.
    patch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
    if (patch.notes !== undefined && leads[idx].notes) patch.notes = !patch.notes || leads[idx].notes.includes(patch.notes) ? leads[idx].notes : `${leads[idx].notes}\n${patch.notes}`.slice(-30000);
    // Proteção: nome automático (webhook) nunca sobrescreve um nome real já definido.
    // "Nome real" = não é número de telefone e não é "Desconhecido".
    // Edições manuais via CRM usam updateLead() — não passam por aqui.
    const existingName = leads[idx].name;
    const existingIsReal =
      existingName &&
      existingName !== leads[idx].phone &&
      existingName !== "Desconhecido" &&
      !/^[\d\s+\-().]{7,}$/.test(existingName);
    if (existingIsReal && patch.name && patch.name !== existingName) {
      console.log(`[leads] bloqueado sobrescrita de nome: "${existingName}" → "${patch.name}" para phone=${phone}`);
      patch = { ...patch };
      delete (patch as Partial<Lead> & { name?: string }).name;
    }
    // Mesmo carimbo de aiPausedAt de updateLead() — ver comentário lá.
    if (patch.aiPaused === true) patch = { ...patch, aiPausedAt: now };
    else if (patch.aiPaused === false) patch = { ...patch, aiPausedAt: null };
    leads[idx] = { ...leads[idx], ...patch, updatedAt: now };
    (await save(leads));
    return leads[idx];
  }
  const lead: Lead = {
    id: randomUUID(),
    clientId,
    funnelId,
    phone: normalizePhone(phone),
    name: patch.name ?? "Desconhecido",
    email: patch.email ?? null,
    source: patch.source ?? "whatsapp",
    adPlatform: patch.adPlatform ?? null,
    campaignName: patch.campaignName ?? null,
    campaignId: patch.campaignId ?? null,
    adSetName: patch.adSetName ?? null,
    adSetId: patch.adSetId ?? null,
    adName: patch.adName ?? null,
    adId: patch.adId ?? null,
    adSourceUrl: patch.adSourceUrl ?? null,
    utmSource: patch.utmSource ?? null,
    utmMedium: patch.utmMedium ?? null,
    utmCampaign: patch.utmCampaign ?? null,
    utmContent: patch.utmContent ?? null,
    utmTerm: patch.utmTerm ?? null,
    fbclid: patch.fbclid ?? null,
    gclid: patch.gclid ?? null,
    fbp: patch.fbp ?? null,
    clientIp: patch.clientIp ?? null,
    clientUserAgent: patch.clientUserAgent ?? null,
    value: patch.value ?? null,
    status: patch.status ?? "novo",
    notes: patch.notes ?? "",
    ai: patch.ai ?? null,
    customFields: patch.customFields,
    isLid: patch.isLid,
    realPhone: patch.realPhone,
    createdAt: now,
    updatedAt: now,
  };
  leads.push(lead);
  (await save(leads));
  (await fireEntryColumnMetaEvent(lead));
  return lead;

  });
}

/** Keep the channel's conversation working while an ambiguous CRM identity is
 * reviewed. No arbitrary contact is chosen, moved, merged or deleted. */
export async function captureWhatsAppLead(clientId: string, phone: string, patch: Partial<Lead>): Promise<Lead | undefined> {
  try { return await upsertLeadByPhone(clientId,phone,patch); }
  catch(error) {
    if (!(error instanceof LeadIdentityConflict)) throw error;
    await withDataTransaction(async () => {
      const normalized=normalizePhone(phone),funnelId=patch.funnelId??"default";
      const rows=await load({clientId,phone,funnelId});
      for(const row of rows) if(row.clientId===clientId&&row.funnelId===funnelId&&[row.phone,row.realPhone].some(value=>value&&normalizePhone(value)===normalized)) {
        row.needsAttention=true;
        row.needsAttentionReason="Há mais de um cadastro para este telefone no funil. Revise os contatos antes de movimentar ou iniciar acompanhamentos.";
        row.needsAttentionAt=new Date().toISOString();
        row.updatedAt=row.needsAttentionAt;
      }
      await save(rows);
    });
    return undefined;
  }
}

export const KANBAN_COLUMNS: { id: LeadStatus; label: string; color: string }[] = [
  { id: "novo",     label: "Novo",              color: "blue"   },
  { id: "contato",  label: "Em Contato",        color: "yellow" },
  { id: "proposta", label: "Proposta Enviada",  color: "orange" },
  { id: "ganho",    label: "Ganho",             color: "green"  },
  { id: "perdido",  label: "Perdido",           color: "slate"  },
];

/** Chat history can still be served when CRM has ambiguous duplicate identities. */
export async function getChatLeadByPhone(clientId:string,phone:string,funnelId?:string):Promise<Lead|undefined>{
 try{return await getLeadByPhone(clientId,phone,funnelId);}catch(error){if(error instanceof LeadIdentityConflict)return undefined;throw error;}
}
