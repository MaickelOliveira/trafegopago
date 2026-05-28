import { NextRequest, NextResponse } from "next/server";
import { upsertLeadByPhone } from "@/lib/leads";

function getCors(req: NextRequest) {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && origin !== "null" ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCors(req) });
}

// Webhook para formulários do site
// POST /api/crm/webhook/form?clientId=xxx
export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  let body: Record<string, string>;
  try {
    const text = await req.text();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const phone = (body.phone ?? body.whatsapp ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  // Detecta plataforma de anúncio
  const utmSourceRaw = (body.utm_source ?? body.utmSource ?? "").toLowerCase();
  const metaSources  = ["facebook", "instagram", "fb", "meta"];
  const adPlatform: "meta" | "google" | null =
    body.fbclid || metaSources.includes(utmSourceRaw)      ? "meta"
    : body.gclid || utmSourceRaw === "google"              ? "google"
    : null;

  // Monta notas com todos os dados extras do formulário
  const formFields: Record<string, string> = {};
  const skip = new Set(["phone", "whatsapp", "name", "nome", "email", "funnelId",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
    "fbclid", "gclid", "campaignName",
    "adId", "campaignId", "adSetName", "adName"]);
  for (const [k, v] of Object.entries(body)) {
    if (!skip.has(k) && v) formFields[k] = v;
  }
  const notesLines = Object.entries(formFields).map(([k, v]) => `${k}: ${v}`);

  const lead = upsertLeadByPhone(clientId, phone, {
    funnelId: body.funnelId ?? "f5abde8a-02ac-47bc-9b91-fd51b9261d39",
    name: body.name ?? body.nome ?? "Lead do site",
    email: body.email ?? null,
    source: "form",
    adPlatform,
    campaignName: body.campaignName ?? body.utm_campaign ?? body.utmCampaign ?? null,
    campaignId: body.campaignId ?? null,
    adSetName:  body.adSetName  ?? null,
    adName:     body.adName     ?? null,
    adId:       body.adId       ?? null,
    utmSource:   body.utm_source   ?? body.utmSource   ?? null,
    utmMedium:   body.utm_medium   ?? body.utmMedium   ?? null,
    utmCampaign: body.utm_campaign ?? body.utmCampaign ?? null,
    utmContent:  body.utm_content  ?? body.utmContent  ?? null,
    utmTerm:     body.utm_term     ?? body.utmTerm     ?? null,
    fbclid: body.fbclid ?? null,
    gclid:  body.gclid  ?? null,
    notes: notesLines.join("\n"),
    status: "novo",
  });

  return NextResponse.json({ ok: true, leadId: lead.id }, { headers: getCors(req) });
}
