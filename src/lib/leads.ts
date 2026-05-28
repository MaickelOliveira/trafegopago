import { readFileSync, writeFileSync, existsSync } from "fs";
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
  customFields?: Record<string, string>; // Campos extras do formulário de origem
  createdAt: string;
  updatedAt: string;
};

const FILE = path.join(process.cwd(), "data", "leads.json");

function load(): Lead[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(leads: Lead[]) {
  writeFileSync(FILE, JSON.stringify(leads, null, 2));
}

export function getLeads(clientId?: string): Lead[] {
  const all = load();
  return clientId ? all.filter((l) => l.clientId === clientId) : all;
}

export function getLeadById(id: string): Lead | undefined {
  return load().find((l) => l.id === id);
}

export function getLeadByPhone(clientId: string, phone: string): Lead | undefined {
  const normalized = phone.replace(/\D/g, "");
  return load().find((l) => l.clientId === clientId && l.phone.replace(/\D/g, "") === normalized);
}

export function createLead(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): Lead {
  const leads = load();
  // Evita duplicata por telefone + cliente + funil
  const existing = leads.find(
    (l) => l.clientId === data.clientId && l.funnelId === data.funnelId && l.phone.replace(/\D/g, "") === data.phone.replace(/\D/g, "")
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

export function upsertLeadByPhone(clientId: string, phone: string, patch: Partial<Lead>): Lead {
  const leads = load();
  const normalized = phone.replace(/\D/g, "");
  const funnelId = patch.funnelId ?? "default";
  const idx = leads.findIndex(
    (l) => l.clientId === clientId && l.funnelId === funnelId && l.phone.replace(/\D/g, "") === normalized
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
    leads[idx] = { ...leads[idx], ...patch, updatedAt: now };
    save(leads);
    return leads[idx];
  }
  const lead: Lead = {
    id: randomUUID(),
    clientId,
    funnelId,
    phone: normalized,
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
