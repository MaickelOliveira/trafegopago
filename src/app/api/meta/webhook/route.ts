import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/clients";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";

const VERIFY_TOKEN = "trafegopago-meta-webhook";

// ── GET — verificação do webhook no Meta Business Manager ────────────────────
export async function GET(req: NextRequest) {
  const mode      = req.nextUrl.searchParams.get("hub.mode");
  const token     = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ── POST — recebe eventos do Meta (Lead Ads + Click to WhatsApp) ─────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  const config = getConfig();
  const metaToken = config.metaToken ?? "";

  for (const entry of (body.entry ?? [])) {
    for (const change of (entry.changes ?? [])) {

      // ── LEAD ADS (formulário nativo Meta) ───────────────────────────────
      if (change.field === "leadgen") {
        const leadgenId = change.value?.leadgen_id;
        const formId    = change.value?.form_id;
        const adId      = change.value?.ad_id;
        const adName    = change.value?.ad_name ?? "";
        const campaignId   = change.value?.campaign_id;
        const campaignName = change.value?.campaign_name ?? "";
        const adsetName    = change.value?.adset_name ?? "";
        const pageId    = change.value?.page_id;

        if (!leadgenId || !metaToken) continue;

        try {
          // Busca dados do lead na API do Meta
          const leadRes = await fetch(
            `https://graph.facebook.com/v19.0/${leadgenId}?fields=field_data,created_time&access_token=${metaToken}`
          );
          if (!leadRes.ok) continue;
          const leadData = await leadRes.json();

          // Extrai campos do formulário
          const fields: Record<string, string> = {};
          for (const f of (leadData.field_data ?? [])) {
            fields[f.name] = Array.isArray(f.values) ? f.values[0] : f.values;
          }

          const phone = (fields.phone_number || fields.phone || fields.telefone || "").replace(/\D/g, "");
          const name  = fields.full_name || fields.nome || fields.name || "Lead Meta Ads";
          const email = fields.email || null;

          if (!phone) continue;

          // Encontra o cliente pelo pageId ou usa o primeiro com metaToken
          const funnels = getFunnels();
          const clientId = funnels.find(f => f.clientId)?.clientId ?? "sem-cliente";
          const funnelId = funnels.find(f => f.clientId === clientId)?.id ?? "default";

          const isNew = !getLeadByPhone(clientId, phone);
          upsertLeadByPhone(clientId, phone, {
            clientId,
            funnelId,
            name,
            phone,
            email,
            source: "form",
            campaignName: campaignName || adName || adsetName || null,
            utmCampaign: campaignId ?? null,
            status: isNew ? "entrada" : undefined,
            notes: [
              campaignName && `Campanha: ${campaignName}`,
              adsetName    && `Conjunto: ${adsetName}`,
              adName       && `Anúncio: ${adName}`,
              formId       && `Form ID: ${formId}`,
              adId         && `Ad ID: ${adId}`,
              pageId       && `Page ID: ${pageId}`,
              ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
            ].filter(Boolean).join("\n"),
          });

          console.log(`[Meta Webhook] Lead Ads: ${name} (${phone}) — campanha: ${campaignName}`);
        } catch (e) {
          console.error("[Meta Webhook] Erro ao processar lead:", e);
        }
      }

      // ── CLICK TO WHATSAPP (mensagem iniciada via anúncio) ───────────────
      if (change.field === "messages") {
        const value = change.value;
        for (const msg of (value?.messages ?? [])) {
          if (msg.type !== "text") continue;
          const phone    = msg.from?.replace(/\D/g, "");
          const text     = msg.text?.body ?? "";
          const pushName = value?.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? phone;

          // Contexto do anúncio (se veio de Click to WhatsApp)
          const referral    = msg.referral;
          const campaignName = referral?.headline ?? referral?.source_type ?? null;
          const adId         = referral?.ad_id ?? null;

          if (!phone || !text.trim()) continue;

          const funnels = getFunnels();
          const clientId = funnels.find(f => f.clientId)?.clientId ?? "sem-cliente";
          const funnelId = funnels.find(f => f.clientId === clientId)?.id ?? "default";

          const isNew = !getLeadByPhone(clientId, phone);
          upsertLeadByPhone(clientId, phone, {
            clientId,
            funnelId,
            name: pushName,
            phone,
            source: "whatsapp",
            campaignName,
            status: isNew ? "entrada" : undefined,
            notes: [
              campaignName && `Origem do anúncio: ${campaignName}`,
              adId         && `Ad ID: ${adId}`,
              referral?.source_url && `URL: ${referral.source_url}`,
            ].filter(Boolean).join("\n") || undefined,
          });

          console.log(`[Meta Webhook] Click to WhatsApp: ${pushName} (${phone})${campaignName ? ` — ${campaignName}` : ""}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
