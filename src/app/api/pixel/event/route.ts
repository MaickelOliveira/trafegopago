import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/lib/clients";
import { formFields } from "@/lib/lead-form";
import { captureFormLead } from "@/lib/lead-notifications";
import { upsertLeadByPhone, getLeadByPhone, type Lead } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { recordClick } from "@/lib/wa-clicks";

type PixelEvent = {
  fields?: Record<string, unknown>;
  clientId?: string;
  event?: string;
  phone?: string;
  name?: string;
  email?: string;
  source?: string;
  url?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
};

const LEAD_EVENTS = ["Lead", "FormSubmit"];

export async function POST(req: NextRequest) {
  let body: PixelEvent;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text) > 65536) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.entries(body).some(([k, v]) => k === "fields" ? !v || typeof v !== "object" || Array.isArray(v) : v != null && typeof v !== "string")) return NextResponse.json({ ok: false }, { status: 400 });
  const { clientId, event, phone, name, email, source, url,
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm, fbclid, gclid } = body;

  if (!clientId) return NextResponse.json({ ok: true });

  // Clique em link de WhatsApp — salva click temporário para o webhook associar depois
  if (event === "WhatsAppClick") {
    (await recordClick({
      clientId,
      utmSource:   utmSource   ?? null,
      utmCampaign: utmCampaign ?? null,
      utmMedium:   utmMedium   ?? null,
      utmContent:  utmContent  ?? null,
      utmTerm:     utmTerm     ?? null,
      fbclid:      fbclid      ?? null,
      gclid:       gclid       ?? null,
    }));
    return NextResponse.json({ ok: true });
  }

  // Só cria lead em eventos relevantes que tenham telefone
  if (!LEAD_EVENTS.includes(event ?? "") || !phone?.trim()) {
    return NextResponse.json({ ok: true });
  }

  const client = (await getClientById(clientId));
  if (!client) return NextResponse.json({ ok: true });

  // Busca o primeiro funil do cliente (ou o funil padrão)
  const funnels = (await getFunnels()).filter((f) => f.clientId === clientId);
  const funnel = client.trackingFunnelId ? funnels.find(funnel => funnel.id === client.trackingFunnelId) : funnels.length === 1 ? funnels[0] : undefined;
  if (!funnel) return NextResponse.json({ error: "Configure o funil de entrada." }, { status: 422 });
  const existing = await getLeadByPhone(clientId, phone, funnel.id);
  const funnelId = funnel?.id ?? "default";
  const firstColumnId = funnel?.columns[0]?.id ?? "entrada";

  const campaignName = utmCampaign ?? undefined;

  const patch: Partial<Lead> = {
    clientId,
    funnelId,
    name: name || phone,
    email: email || null,
    source: (source as "whatsapp" | "form" | "manual") ?? "form",
    ...(existing ? {} : { status: firstColumnId }),
    campaignName: campaignName ?? null,
    utmSource: utmSource ?? null,
    utmMedium: utmMedium ?? null,
    utmCampaign: utmCampaign ?? null,
    utmContent: utmContent ?? null,
    utmTerm: utmTerm ?? null,
    fbclid: fbclid ?? null,
    gclid: gclid ?? null,
  };
  const digits = phone.replace(/\D/g, "");
  if (event === "FormSubmit" || (event === "Lead" && source === "form")) {
    const answers = formFields(body.fields ?? {});
    if (Object.keys(answers).length) patch.customFields = answers;
    let page = "";
    try { const parsed = new URL(url || ""); if (["https:", "http:"].includes(parsed.protocol)) page = parsed.origin + parsed.pathname; } catch {}
    await captureFormLead(clientId, digits, patch, "pixel:" + funnel.id, {
      source: page || "Formulário do site", name: name || phone, phone, email,
      fields: { ...formFields({ phone, name, email, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, fbclid, gclid }), ...answers },
    });
  } else {
    await upsertLeadByPhone(clientId, digits, patch);
  }

  return NextResponse.json({ ok: true });
}

// Suporte a sendBeacon (Content-Type: text/plain)
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
