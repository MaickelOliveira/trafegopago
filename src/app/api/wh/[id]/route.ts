import { NextRequest, NextResponse } from "next/server";
import { getWebhookById, incrementWebhookCount } from "@/lib/webhooks";
import { getFunnelById } from "@/lib/funnels";
import { createLead, getLeadByPhone } from "@/lib/leads";
import { runAutomationsForEvent } from "@/lib/crm-automations";

export const dynamic = "force-dynamic";

/**
 * Receptor de leads via webhook.
 * Aceita POST com JSON ou application/x-www-form-urlencoded.
 * URL: /api/wh/{webhookId}
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const wh = getWebhookById(id);
  if (!wh || !wh.active) {
    return NextResponse.json({ error: "Webhook não encontrado ou inativo" }, { status: 404 });
  }

  // Parse do corpo — suporta JSON e form-urlencoded
  let payload: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      payload = await req.json();
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const form = await req.formData();
      form.forEach((v, k) => { payload[k] = String(v); });
    } else {
      // Tenta JSON de qualquer forma
      const text = await req.text();
      try { payload = JSON.parse(text); } catch { payload = {}; }
    }
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Mapeamento de campos
  const { nameField, phoneField, emailField } = wh.fieldMapping;
  // Campos comuns como fallback se o mapeamento não encontrar
  const name = payload[nameField] || payload.nome || payload.name || "Desconhecido";
  const rawPhone = payload[phoneField] || payload.telefone || payload.phone || payload.celular || "";
  const email = emailField ? (payload[emailField] || payload.email || null) : (payload.email || null);

  const phone = rawPhone.replace(/\D/g, "");
  if (!phone) {
    return NextResponse.json({ error: "Telefone não encontrado no payload" }, { status: 422 });
  }

  // Captura todos os campos extras (excluindo os campos já mapeados e UTMs)
  const SKIP_KEYS = new Set([
    nameField, phoneField, emailField ?? "",
    "nome", "name", "telefone", "phone", "celular", "email",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "campanha",
  ]);
  const customFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!SKIP_KEYS.has(k) && v && String(v).trim()) {
      customFields[k] = String(v);
    }
  }

  const funnel = getFunnelById(wh.funnelId);
  const columnExists = funnel?.columns.some((c) => c.id === wh.columnId) ?? false;
  const columnId = columnExists ? wh.columnId : (funnel?.columns[0]?.id ?? "entrada");

  // Detecta plataforma de origem
  const utmSourceRaw = (payload.utm_source ?? "").toLowerCase();
  const metaSources = ["facebook", "instagram", "fb", "meta"];
  const adPlatform: "meta" | "google" | null =
    payload.fbclid || metaSources.includes(utmSourceRaw) ? "meta"
    : payload.gclid || utmSourceRaw === "google"         ? "google"
    : null;

  // Evita duplicata — se lead já existe no mesmo funil, não recria
  const existing = getLeadByPhone(wh.clientId, phone);
  let lead;
  if (existing) {
    lead = existing;
  } else {
    lead = createLead({
      clientId: wh.clientId,
      funnelId: wh.funnelId,
      name,
      phone,
      email: email ?? null,
      source: "form",
      status: columnId,
      notes: `Origem: ${wh.name}`,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
      adPlatform,
      campaignName: payload.utm_campaign || payload.campanha || null,
      utmSource: payload.utm_source || null,
      utmMedium: payload.utm_medium || null,
      utmCampaign: payload.utm_campaign || null,
      utmContent: payload.utm_content || null,
      utmTerm: payload.utm_term || null,
      fbclid: payload.fbclid || null,
      gclid: payload.gclid || null,
      value: null,
      ai: null,
    });
    incrementWebhookCount(id);
    // Dispara automações CRM de lead_created e column_entered (fire-and-forget)
    runAutomationsForEvent("lead_created", lead, { webhookId: id });
    runAutomationsForEvent("column_entered", lead, { toColumnId: columnId });
  }

  return NextResponse.json({ ok: true, leadId: lead.id, name: lead.name, phone: lead.phone });
}

/** GET para verificação — retorna info do webhook sem dados sensíveis. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const wh = getWebhookById(id);
  if (!wh) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id: wh.id, name: wh.name, active: wh.active, leadCount: wh.leadCount });
}
