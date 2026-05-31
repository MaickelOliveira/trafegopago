import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type LeadStatus = "novo" | "contato" | "proposta" | "ganho" | "perdido";
export type LeadSource = "whatsapp" | "form" | "manual";
export type AdPlatform = "meta" | "google" | null;

export type LeadAI = {
  summary: string;
  score: number; // 1-10
  nextStep: string;
  generatedAt: string;
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
  createdAt: string;
  updatedAt: string;
};

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "leads.json");
const BAK  = FILE + ".bak";
const TMP  = FILE + ".tmp";

function load(): Lead[] {
  // Tenta arquivo principal
  try {
    if (existsSync(FILE)) {
      const raw = readFileSync(FILE, "utf-8");
      if (raw.trim()) return JSON.parse(raw);
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
}

export function getLeads(clientId?: string): Lead[] {
  const all = load();
  return clientId ? all.filter((l) => l.clientId === clientId) : all;
}

export function getLeadById(id: string): Lead | undefined {
  return load().find((l) => l.id === id);
}

export function getLeadByPhone(clientId: string, phone: string): Lead | undefined {
  const normalized = normalizePhone(phone);
  return load().find(
    (l) =>
      l.clientId === clientId &&
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
function normalizePhone(raw: string): string {
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
  // Busca APENAS por clientId + telefone normalizado, sem restringir por funnelId.
  // Isso evita duplicatas quando o mesmo número chega via canais/funis diferentes.
  const idx = leads.findIndex(
    (l) =>
      l.clientId === clientId &&
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
