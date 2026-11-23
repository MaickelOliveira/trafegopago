import { attributionPlatform } from "@/lib/lead-attribution";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getLeadByPhone } from "@/lib/leads";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { formFields as readFormFields } from "@/lib/lead-form";
import { captureFormLead } from "@/lib/lead-notifications";

function getCors(req: NextRequest) {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && origin !== "null" ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",

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
    if (Buffer.byteLength(text) > 65536) return NextResponse.json({ error: "Formulário muito grande." }, { status: 413, headers: getCors(req) });
    body = readFormFields(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.values(body).some(value => typeof value !== "string") || JSON.stringify(body).length > 65536) return NextResponse.json({ error: "Formulário inválido." }, { status: 400, headers: getCors(req) });
  const client = await getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Destino não encontrado." }, { status: 404 });
  const funnels = (await getFunnels()).filter(funnel => funnel.clientId === clientId);
  const funnel = funnels.find(funnel => funnel.id === (body.funnelId || client.trackingFunnelId)) ?? (!body.funnelId && !client.trackingFunnelId && funnels.length === 1 ? funnels[0] : undefined);
  if (!funnel) return NextResponse.json({ error: "Configure o funil de entrada deste cliente." }, { status: 422, headers: getCors(req) });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!checkRateLimit(`form:${clientId}:${ip}`, 30, 60000)) return NextResponse.json({ error: "Aguarde antes de tentar novamente." }, { status: 429 });
  const rawPhone = body.phone || body.whatsapp || body.telefone || body.celular || "";
  const phone = rawPhone.replace(/\D/g, "");
  if (phone.length < 7 || phone.length > 20) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  // Detecta plataforma de anúncio
  const adPlatform = attributionPlatform({ utmSource: body.utm_source ?? body.utmSource, fbclid: body.fbclid, gclid: body.gclid });

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

  const existing = await getLeadByPhone(clientId, phone, funnel.id);
  const initialStatus = clientId === "pro-nexo" && funnel.columns.some(column => column.id === "novo")
    ? "novo"
    : funnel.columns[0]?.id ?? "novo";
  const lead = await captureFormLead(clientId, phone, {
    funnelId: funnel.id,
    name: body.name ?? body.nome ?? "Lead do site",
    email: body.email ?? null,
    source: "form",
    adPlatform,
    campaignName: body.campaignName ?? body.utm_campaign ?? body.utmCampaign ?? null,
    campaignId: body.campaign_id ?? body.campaignId ?? null,
    adSetId: body.adset_id ?? body.adSetId ?? null,
    adSetName:  body.adSetName  ?? null,
    adName:     body.adName     ?? null,
    adId:       body.ad_id ?? body.adId ?? null,
    utmSource:   body.utm_source   ?? body.utmSource   ?? null,
    utmMedium:   body.utm_medium   ?? body.utmMedium   ?? null,
    utmCampaign: body.utm_campaign ?? body.utmCampaign ?? null,
    utmContent:  body.utm_content  ?? body.utmContent  ?? null,
    utmTerm:     body.utm_term     ?? body.utmTerm     ?? null,
    fbclid: body.fbclid ?? null,
    gclid:  body.gclid  ?? null,
    customFields: formFields,
    notes: notesLines.join("\n"),
    ...(existing ? {} : { status: initialStatus }),
  }, "site:" + funnel.id, {
    source: "Formulário do site", name: body.name || body.nome || "Lead do site", phone: rawPhone, email: body.email, fields: body,
  }, req.headers.get("idempotency-key") || body.submissionId);

  return NextResponse.json({ ok: true, leadId: lead.id }, { headers: getCors(req) });
}
