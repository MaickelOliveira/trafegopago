import { NextRequest, NextResponse } from "next/server";
import { getWebhookById, incrementWebhookCount } from "@/lib/webhooks";
import { getFunnelById } from "@/lib/funnels";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getClientById } from "@/lib/clients";
import { sendCapiEvent } from "@/lib/meta-capi";
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
  const name = payload[nameField] || payload.nome || payload.name || payload["your-name"] || "Desconhecido";
  const rawPhone = payload[phoneField] || payload.telefone || payload.phone || payload.celular || payload["your-phone"] || "";
  const email = emailField ? (payload[emailField] || payload.email || payload["your-email"] || null) : (payload.email || payload["your-email"] || null);

  const phone = rawPhone.replace(/\D/g, "");
  if (!phone) {
    return NextResponse.json({ error: "Telefone não encontrado no payload" }, { status: 422 });
  }

  // IP e User-Agent reais do navegador que chamou o webhook — a requisição
  // vem direto do site (fetch client-side), então é o momento mais próximo
  // possível da conversão real pra esses dois dados (usados pelo Meta CAPI).
  const clientIp = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim())
    || req.headers.get("x-real-ip")
    || null;
  const clientUserAgent = req.headers.get("user-agent") || null;

  // Captura todos os campos extras (excluindo os campos já mapeados e UTMs)
  const SKIP_KEYS = new Set([
    nameField, phoneField, emailField ?? "",
    "nome", "name", "telefone", "phone", "celular", "email",
    "your-name", "your-phone", "your-email",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "campanha", "fbp",
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

  // Checa ANTES do upsert se o lead já existia — só dispara o evento CAPI
  // "Lead" pra quem é realmente novo, não a cada reenvio do mesmo telefone.
  const isNewLead = !getLeadByPhone(wh.clientId, phone, wh.funnelId);

  // Upsert: se lead já existe no mesmo funil (mesmo se veio por WhatsApp), atualiza status
  // para a coluna configurada no webhook (ex: "Novo"). Se não existe, cria.
  const lead = upsertLeadByPhone(wh.clientId, phone, {
    funnelId: wh.funnelId,
    name,
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
    fbp: payload.fbp || null,
    clientIp,
    clientUserAgent,
    value: null,
    ai: null,
  });
  incrementWebhookCount(id);

  // Dispara evento CAPI "Lead" pra lead novo — esse webhook já captura telefone,
  // e-mail, nome, fbclid, fbp, IP e User-Agent reais no momento exato da
  // conversão, então tende a ter qualidade de correspondência melhor que
  // eventos disparados depois (ex: mudança de coluna no Kanban).
  if (isNewLead) {
    const client = getClientById(wh.clientId);
    if (client?.pixelId) {
      sendCapiEvent({
        pixelId: client.pixelId,
        capiToken: client.capiToken,
        testEventCode: client.capiTestEventCode || undefined,
        eventName: "Lead",
        phone: lead.phone,
        email: lead.email ?? undefined,
        name: lead.name,
        fbclid: lead.fbclid ?? undefined,
        fbp: lead.fbp ?? undefined,
        clientIp: lead.clientIp ?? undefined,
        clientUserAgent: lead.clientUserAgent ?? undefined,
        externalId: lead.id,
      }).catch((e) => console.error("[Meta CAPI]", e));
    }
  }

  // Dispara automações CRM
  runAutomationsForEvent("lead_created", lead, { webhookId: id });
  runAutomationsForEvent("column_entered", lead, { toColumnId: columnId });

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
