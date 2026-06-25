import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, statSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAllConversationsByClientId } from "./conversations";

export type LeadStatus = "novo" | "contato" | "proposta" | "ganho" | "perdido";
export type LeadSource = "whatsapp" | "form" | "manual";
export type AdPlatform = "meta" | "google" | null;

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
  value: number | null;
  status: string; // coluna do funil (dinâmica)
  notes: string;
  ai: LeadAI | null;
  aiPaused?: boolean; // IA pausada para esta conversa (especialista assumiu)
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

// Cache em memória — só relê o disco quando o arquivo muda (mtime)
let _cache: Lead[] | null = null;
let _cacheMtime = 0;

function load(): Lead[] {
  // Tenta arquivo principal
  try {
    if (existsSync(FILE)) {
      const mtime = statSync(FILE).mtimeMs;
      if (_cache && mtime === _cacheMtime) return _cache;
      const raw = readFileSync(FILE, "utf-8");
      if (raw.trim()) {
        _cache = JSON.parse(raw);
        _cacheMtime = mtime;
        return _cache!;
      }
    }
  } catch {
    console.warn("[leads] leads.json corrompido, tentando backup...");
  }
  // Fallback: backup anterior
  try {
    if (existsSync(BAK)) {
      console.warn("[leads] Restaurando de leads.json.bak");
      return JSON.parse(readFileSync(BAK, "utf-8"));
    }
  } catch {
    // nada a fazer
  }
  return [];
}

function save(leads: Lead[]) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  // 1. Escreve em arquivo temporário
  writeFileSync(TMP, JSON.stringify(leads, null, 2));
  // 2. Backup do arquivo atual (se existir)
  if (existsSync(FILE)) renameSync(FILE, BAK);
  // 3. Rename atômico: tmp → principal
  renameSync(TMP, FILE);
  // 4. Atualiza cache imediatamente
  _cache = leads;
  try { _cacheMtime = statSync(FILE).mtimeMs; } catch { /* ignore */ }
}

export function getLeads(clientId?: string): Lead[] {
  const all = load();
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
export function attachLeadsHeat(leads: Lead[]): Lead[] {
  const heatByLeadId = new Map<string, Lead["heat"]>();
  const leadsByClient = new Map<string, Lead[]>();
  for (const lead of leads) {
    const group = leadsByClient.get(lead.clientId) ?? [];
    group.push(lead);
    leadsByClient.set(lead.clientId, group);
  }
  for (const [clientId, clientLeads] of leadsByClient) {
    const conversations = getAllConversationsByClientId(clientId);
    const byPhone = new Map(conversations.map((c) => [normalizePhone(c.phone), c]));
    for (const lead of clientLeads) {
      const conv = byPhone.get(normalizePhone(lead.realPhone || lead.phone));
      if (conv) heatByLeadId.set(lead.id, computeHeat(conv.messageCount, conv.lastActivity));
    }
  }
  return leads.map((lead) => heatByLeadId.has(lead.id) ? { ...lead, heat: heatByLeadId.get(lead.id) } : lead);
}

export function getLeadById(id: string): Lead | undefined {
  return load().find((l) => l.id === id);
}

/** Marca um lead como precisando de atenção humana — chamado quando a IA dispara resumo_solicitado */
export function markLeadNeedsAttention(clientId: string, phone: string, funnelId: string | undefined, motivo: string): void {
  const lead = getLeadByPhone(clientId, phone, funnelId);
  if (!lead) return;
  updateLead(lead.id, { needsAttention: true, needsAttentionReason: motivo, needsAttentionAt: new Date().toISOString() });
}

export function getLeadByPhone(clientId: string, phone: string, funnelId?: string): Lead | undefined {
  const normalized = normalizePhone(phone);
  return load().find(
    (l) =>
      l.clientId === clientId &&
      (!funnelId || l.funnelId === funnelId) &&
      (normalizePhone(l.phone) === normalized ||
        (l.realPhone != null && normalizePhone(l.realPhone) === normalized)),
  );
}

export function createLead(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): Lead {
  const leads = load();
  // Evita duplicata por telefone + cliente + funil (checa também realPhone)
  const normalizedNew = normalizePhone(data.phone);
  const existing = leads.find(
    (l) =>
      l.clientId === data.clientId &&
      l.funnelId === data.funnelId &&
      (normalizePhone(l.phone) === normalizedNew ||
        (l.realPhone != null && normalizePhone(l.realPhone) === normalizedNew)),
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const lead: Lead = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
  leads.push(lead);
  save(leads);
  return lead;
}

export function updateLead(id: string, patch: Partial<Omit<Lead, "id" | "createdAt">>): Lead | null {
  const leads = load();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx < 0) return null;
  leads[idx] = { ...leads[idx], ...patch, updatedAt: new Date().toISOString() };
  save(leads);
  return leads[idx];
}

export function deleteLead(id: string): boolean {
  const leads = load();
  const filtered = leads.filter((l) => l.id !== id);
  if (filtered.length === leads.length) return false;
  save(filtered);
  return true;
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

export function upsertLeadByPhone(clientId: string, phone: string, patch: Partial<Lead>): Lead {
  const leads = load();
  const normalized = normalizePhone(phone);
  const funnelId = patch.funnelId ?? "default";
  // Busca por clientId + funnelId + telefone normalizado.
  // Mesmo número em funnels diferentes = leads separados (cada agente/canal tem seu próprio lead).
  // Mesmo número no mesmo funil = um único lead (sem duplicata).
  const idx = leads.findIndex(
    (l) =>
      l.clientId === clientId &&
      l.funnelId === funnelId &&
      (normalizePhone(l.phone) === normalized ||
        (l.realPhone != null && normalizePhone(l.realPhone) === normalized)),
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
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
    leads[idx] = { ...leads[idx], ...patch, updatedAt: now };
    save(leads);
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
    value: patch.value ?? null,
    status: patch.status ?? "novo",
    notes: patch.notes ?? "",
    ai: patch.ai ?? null,
    createdAt: now,
    updatedAt: now,
  };
  leads.push(lead);
  save(leads);
  return lead;
}

export const KANBAN_COLUMNS: { id: LeadStatus; label: string; color: string }[] = [
  { id: "novo",     label: "Novo",              color: "blue"   },
  { id: "contato",  label: "Em Contato",        color: "yellow" },
  { id: "proposta", label: "Proposta Enviada",  color: "orange" },
  { id: "ganho",    label: "Ganho",             color: "green"  },
  { id: "perdido",  label: "Perdido",           color: "slate"  },
];
