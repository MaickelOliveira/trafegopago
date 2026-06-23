import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type TemplateCategory = "MARKETING" | "UTILITY";
export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DRAFT";
export type TemplateLanguage = "pt_BR" | "en_US" | "es_ES";

export type TemplateButton = {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone?: string;
};

export type TemplateComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  buttons?: TemplateButton[];
};

export type WabaTemplate = {
  id: string;              // ID local
  metaId?: string;         // ID retornado pela Meta API
  clientId: string;
  wabaId?: string;         // WABA ID usado no envio para Meta
  phoneNumberId?: string;  // Phone Number ID para envio
  metaToken?: string;      // token Meta com permissão waba_management
  name: string;            // nome do template (snake_case, único por WABA)
  category: TemplateCategory;
  language: TemplateLanguage;
  components: TemplateComponent[];
  status: TemplateStatus;
  rejectedReason?: string;
  createdAt: string;
  updatedAt: string;
};

const FILE = path.join(process.cwd(), "data", "waba-templates.json");

function load(): WabaTemplate[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: WabaTemplate[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function getTemplates(clientId?: string): WabaTemplate[] {
  const all = load();
  return clientId ? all.filter((t) => t.clientId === clientId) : all;
}

export function getTemplateById(id: string): WabaTemplate | undefined {
  return load().find((t) => t.id === id);
}

export function createTemplate(data: Omit<WabaTemplate, "id" | "createdAt" | "updatedAt">): WabaTemplate {
  const items = load();
  const now = new Date().toISOString();
  const tpl: WabaTemplate = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
  items.push(tpl);
  save(items);
  return tpl;
}

export function updateTemplate(id: string, patch: Partial<Omit<WabaTemplate, "id" | "createdAt">>): WabaTemplate | null {
  const items = load();
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
  save(items);
  return items[idx];
}

export function deleteTemplate(id: string): boolean {
  const items = load();
  const filtered = items.filter((t) => t.id !== id);
  if (filtered.length === items.length) return false;
  save(filtered);
  return true;
}

/** Sincroniza status de um template com a Meta API. Retorna o template atualizado. */
export async function syncTemplateStatus(tpl: WabaTemplate): Promise<WabaTemplate> {
  if (!tpl.metaId || !tpl.metaToken) return tpl;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${tpl.metaId}?fields=id,name,status,rejected_reason&access_token=${tpl.metaToken}`,
    );
    if (!res.ok) return tpl;
    const data = await res.json() as { id: string; name: string; status: string; rejected_reason?: string };
    const metaStatus = (data.status ?? "PENDING").toUpperCase() as TemplateStatus;
    return updateTemplate(tpl.id, { status: metaStatus, rejectedReason: data.rejected_reason }) ?? tpl;
  } catch {
    return tpl;
  }
}

/** Envia template aprovado para um número via Meta Cloud API. */
export async function sendTemplate(
  phoneNumberId: string,
  metaToken: string,
  toPhone: string,
  templateName: string,
  languageCode: string,
  components?: object[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const body = {
      messaging_product: "whatsapp",
      to: toPhone.replace(/\D/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components && components.length > 0 ? { components } : {}),
      },
    };
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${metaToken}` },
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    let data: { messages?: { id: string }[]; contacts?: unknown[]; error?: { message?: string } } | null = null;
    try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* corpo não-JSON */ }

    // Mesmo com status 2xx, a Graph API pode retornar um objeto "error" no corpo
    // (ex: template pausado, número fora da janela de teste) — sem checar isso,
    // marcávamos como enviado indevidamente (mesmo bug já corrigido em sendMessageDirect).
    if (!res.ok || data?.error) {
      const err = data?.error?.message ?? bodyText.slice(0, 300);
      console.error(`[sendTemplate] FALHOU status=${res.status} to=${toPhone} template=${templateName} erro="${err}"`);
      return { success: false, error: err };
    }
    const wamid = data?.messages?.[0]?.id ?? "sem-wamid";
    console.log(`[sendTemplate] HTTP 200 wamid=${wamid} to=${toPhone} template=${templateName}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
