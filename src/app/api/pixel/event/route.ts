import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/lib/clients";
import { upsertLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { recordClick } from "@/lib/wa-clicks";

type PixelEvent = {
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
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { clientId, event, phone, name, email, source, url,
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm, fbclid, gclid } = body;

  if (!clientId) return NextResponse.json({ ok: true });

  // Clique em link de WhatsApp — salva click temporário para o webhook associar depois
  if (event === "WhatsAppClick") {
    recordClick({
      clientId,
      utmSource:   utmSource   ?? null,
      utmCampaign: utmCampaign ?? null,
      utmMedium:   utmMedium   ?? null,
      utmContent:  utmContent  ?? null,
      utmTerm:     utmTerm     ?? null,
      fbclid:      fbclid      ?? null,
      gclid:       gclid       ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  // Só cria lead em eventos relevantes que tenham telefone
  if (!LEAD_EVENTS.includes(event ?? "") || !phone?.trim()) {
    return NextResponse.json({ ok: true });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ ok: true });

  // Busca o primeiro funil do cliente (ou o funil padrão)
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const funnel = funnels[0];
  const funnelId = funnel?.id ?? "default";
  const firstColumnId = funnel?.columns[0]?.id ?? "entrada";

  const campaignName = utmCampaign ?? undefined;

  upsertLeadByPhone(clientId, phone.replace(/\D/g, ""), {
    clientId,
    funnelId,
    name: name || phone,
    email: email || null,
    source: (source as "whatsapp" | "form" | "manual") ?? "form",
    status: firstColumnId,
    campaignName: campaignName ?? null,
    utmSource: utmSource ?? null,
    utmMedium: utmMedium ?? null,
    utmCampaign: utmCampaign ?? null,
    utmContent: utmContent ?? null,
    utmTerm: utmTerm ?? null,
    fbclid: fbclid ?? null,
    gclid: gclid ?? null,
  });

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
