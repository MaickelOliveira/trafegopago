import { verifyMetaSignature } from "@/lib/webhook-auth";
import { NextRequest, NextResponse } from "next/server";
import { getConfig, getClients } from "@/lib/clients";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { getAdInfoById } from "@/lib/meta-api";

const VERIFY_TOKEN = "trafegopago-meta-webhook";

// ── Helpers de resolução de cliente ─────────────────────────────────────────

/** Resolve clientId + funnelId a partir de um pageId (Lead Ads) */
async function resolveClientByPageId(pageId?: string): Promise<{ clientId: string; funnelId: string } | null> {
  if (!pageId) return null;
  const clients = (await getClients());
  const matches = clients.filter(c => c.metaPageId && c.metaPageId === pageId);
  const client = matches.length === 1 ? matches[0] : undefined;
  if (!client) return null;
  const funnels = (await getFunnels());
  const owned = funnels.filter(funnel => funnel.clientId === client.id);
  const funnel = client.trackingFunnelId ? owned.find(funnel => funnel.id === client.trackingFunnelId) : owned.length === 1 ? owned[0] : undefined;
  return funnel ? { clientId: client.id, funnelId: funnel.id } : null;
}

/** Resolve clientId + funnelId a partir do phoneNumberId (CTWA — conexão Meta) */
async function resolveClientByPhoneNumberId(phoneNumberId?: string): Promise<{ clientId: string; funnelId: string } | null> {
  if (!phoneNumberId) return null;
  const funnels = (await getFunnels());
  const matches = funnels.filter(funnel => funnel.connections?.some(connection => connection.type === "meta" && connection.metaPhoneNumberId === phoneNumberId));
  return matches.length === 1 && matches[0].clientId ? { clientId: matches[0].clientId, funnelId: matches[0].id } : null;
}

// ── GET — verificação do webhook no Meta Business Manager ────────────────────
export async function GET(req: NextRequest) {
  const mode      = req.nextUrl.searchParams.get("hub.mode");
  const token     = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge)
    return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ── POST — recebe eventos do Meta (Lead Ads + Click to WhatsApp) ─────────────
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) return NextResponse.json({ error: "Payload muito grande." }, { status: 413 });
  const appSecret = (await getConfig()).metaAppSecret || process.env.META_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: "Configure a chave de verificação da Meta." }, { status: 503 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return NextResponse.json({ error: "Assinatura inválida." }, { status: 403 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }

  if (!body) return NextResponse.json({ ok: true });

  const config = (await getConfig());
  const metaToken = config.metaToken ?? "";

  for (const entry of (body.entry ?? [])) {
    for (const change of (entry.changes ?? [])) {

      // ── LEAD ADS (formulário nativo Meta) ───────────────────────────────
      if (change.field === "leadgen") {
        const { leadgen_id, form_id, ad_id, ad_name = "", campaign_id, campaign_name = "", adset_id, adset_name = "", page_id } = change.value ?? {};
        if (!leadgen_id || !metaToken) continue;

        try {
          const leadRes = await fetch(
            `https://graph.facebook.com/v26.0/${leadgen_id}?fields=field_data,created_time&access_token=${metaToken}`
          );
          if (!leadRes.ok) continue;
          const leadData = await leadRes.json();

          const fields: Record<string, string> = {};
          for (const f of (leadData.field_data ?? []))
            fields[f.name] = Array.isArray(f.values) ? f.values[0] : f.values;

          const phone = (fields.phone_number || fields.phone || fields.telefone || "").replace(/\D/g, "");
          const name  = fields.full_name || fields.nome || fields.name || "Lead Meta Ads";
          const email = fields.email || null;
          if (!phone) continue;

          // Resolve cliente pelo pageId (configurado em Configurações do cliente)
          const resolved = (await resolveClientByPageId(page_id));
          if (!resolved) continue;
          const { clientId, funnelId } = resolved;
          const isNew = !(await getLeadByPhone(clientId, phone, funnelId));

          // Remove campos já mapeados das notas extras
          const knownFields = new Set(["phone_number","phone","telefone","full_name","nome","name","email"]);
          const extraFields = Object.entries(fields).filter(([k]) => !knownFields.has(k));

          (await upsertLeadByPhone(clientId, phone, {
            clientId, funnelId, name, phone, email,
            source: "form",
            adPlatform: "meta",
            campaignName: campaign_name || ad_name || adset_name || null,
            campaignId: campaign_id ?? null,
            adSetName: adset_name || null,
            adSetId: adset_id ?? null,
            adName: ad_name || null,
            adId: ad_id ?? null,
            utmCampaign: campaign_id ?? null,
            fbclid: null,
            status: isNew ? "novo" : undefined,
            notes: [
              campaign_name && `Campanha: ${campaign_name}`,
              adset_name    && `Conjunto: ${adset_name}`,
              ad_name       && `Anúncio: ${ad_name}`,
              form_id       && `Form ID: ${form_id}`,
              ad_id         && `Ad ID: ${ad_id}`,
              page_id       && `Page ID: ${page_id}`,
              ...extraFields.map(([k, v]) => `${k}: ${v}`),
            ].filter(Boolean).join("\n"),
          }));

          console.log(`[Meta/LeadAds] ${name} (${phone}) — cliente: ${clientId} — campanha: ${campaign_name}`);
        } catch (e) {
          console.error("[Meta/LeadAds] Erro:", e);
        }
      }

      // ── CLICK TO WHATSAPP (mensagem iniciada via anúncio) ───────────────
      if (change.field === "messages") {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        for (const msg of (value?.messages ?? [])) {
          if (msg.type !== "text") continue;
          const phone    = msg.from?.replace(/\D/g, "");
          const text     = msg.text?.body ?? "";
          const pushName = value?.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? phone;
          const referral = msg.referral;
          // O campo do ad_id no referral oficial da Cloud API é `source_id`
          // (não `ad_id` — esse campo não existe nesse payload, por isso o
          // lookup da campanha nunca rodava antes desse fix).
          const ctwaAdId: string | undefined = referral?.source_id ?? undefined;

          if (!phone || !text.trim()) continue;

          // Resolve cliente pelo phoneNumberId da conexão Meta
          const resolved = (await resolveClientByPhoneNumberId(phoneNumberId));
          if (!resolved) continue;
          const { clientId, funnelId } = resolved;
          const isNew = !(await getLeadByPhone(clientId, phone, funnelId));

          // Resolve o nome real da campanha via Graph API (mesmo padrão já
          // usado nos webhooks WPPConnect/UazAPI) — headline do referral é
          // só o título do anúncio, não o nome da campanha.
          let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
          if (ctwaAdId && metaToken) {
            adInfo = await getAdInfoById(ctwaAdId, metaToken).catch(() => null);
          }

          (await upsertLeadByPhone(clientId, phone, {
            clientId, funnelId,
            name: pushName,
            phone,
            source: "whatsapp",
            ...(adInfo ? {
              adPlatform: "meta",
              adId: adInfo.adId,
              adName: adInfo.adName,
              adSetId: adInfo.adSetId,
              adSetName: adInfo.adSetName,
              campaignId: adInfo.campaignId,
              campaignName: adInfo.campaignName,
            } : referral ? {
              adPlatform: "meta",
              adId: ctwaAdId ?? null,
              campaignName: referral.headline ?? null,
            } : { adPlatform: null, campaignName: null }),
            fbclid: null,
            status: isNew ? "novo" : undefined,
            notes: referral ? [
              adInfo?.campaignName  && `Campanha: ${adInfo.campaignName}`,
              referral.headline     && `Anúncio: ${referral.headline}`,
              ctwaAdId              && `Ad ID: ${ctwaAdId}`,
              referral.source_url   && `URL: ${referral.source_url}`,
              referral.source_type  && `Tipo: ${referral.source_type}`,
            ].filter(Boolean).join("\n") : undefined,
          }));

          console.log(`[Meta/CTWA] ${pushName} (${phone}) — cliente: ${clientId}${adInfo ? ` — campanha: ${adInfo.campaignName}` : referral ? ` — anúncio: ${referral.headline}` : ""}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

