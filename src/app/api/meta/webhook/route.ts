import { NextRequest, NextResponse } from "next/server";
import { getConfig, getClients } from "@/lib/clients";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";

const VERIFY_TOKEN = "trafegopago-meta-webhook";

// ── Helpers de resolução de cliente ─────────────────────────────────────────

/** Resolve clientId + funnelId a partir de um pageId (Lead Ads) */
function resolveClientByPageId(pageId?: string): { clientId: string; funnelId: string } | null {
  if (!pageId) return null;
  const clients = getClients();
  const client = clients.find(c => c.metaPageId && c.metaPageId === pageId);
  if (!client) return null;
  const funnels = getFunnels();
  const funnel = funnels.find(f => f.clientId === client.id);
  return funnel ? { clientId: client.id, funnelId: funnel.id } : null;
}

/** Resolve clientId + funnelId a partir do phoneNumberId (CTWA — conexão Meta) */
function resolveClientByPhoneNumberId(phoneNumberId?: string): { clientId: string; funnelId: string } | null {
  if (!phoneNumberId) return null;
  const funnels = getFunnels();
  for (const funnel of funnels) {
    const conn = funnel.connections?.find(c => c.type === "meta" && c.metaPhoneNumberId === phoneNumberId);
    if (!conn) continue;
    if (funnel.clientId) return { clientId: funnel.clientId, funnelId: funnel.id };
    // Funil sem clientId: busca pelo agentConfig do cliente que aponta para esta conexão
    const client = getClients().find(c =>
      c.agentConfig?.whatsappConnectionId === conn.id ||
      c.agentConfigs?.some(a => a.whatsappConnectionId === conn.id)
    );
    if (client) return { clientId: client.id, funnelId: funnel.id };
  }
  return null;
}

/** Fallback: primeiro cliente com funil */
function resolveClientFallback(): { clientId: string; funnelId: string } {
  const funnels = getFunnels();
  const first = funnels.find(f => f.clientId);
  return { clientId: first?.clientId ?? "sem-cliente", funnelId: first?.id ?? "default" };
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
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  const config = getConfig();
  const metaToken = config.metaToken ?? "";

  for (const entry of (body.entry ?? [])) {
    for (const change of (entry.changes ?? [])) {

      // ── LEAD ADS (formulário nativo Meta) ───────────────────────────────
      if (change.field === "leadgen") {
        const { leadgen_id, form_id, ad_id, ad_name = "", campaign_id, campaign_name = "", adset_id, adset_name = "", page_id } = change.value ?? {};
        if (!leadgen_id || !metaToken) continue;

        try {
          const leadRes = await fetch(
            `https://graph.facebook.com/v19.0/${leadgen_id}?fields=field_data,created_time&access_token=${metaToken}`
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
          const resolved = resolveClientByPageId(page_id) ?? resolveClientFallback();
          const { clientId, funnelId } = resolved;
          const isNew = !getLeadByPhone(clientId, phone);

          // Remove campos já mapeados das notas extras
          const knownFields = new Set(["phone_number","phone","telefone","full_name","nome","name","email"]);
          const extraFields = Object.entries(fields).filter(([k]) => !knownFields.has(k));

          upsertLeadByPhone(clientId, phone, {
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
          });

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

          if (!phone || !text.trim()) continue;

          // Resolve cliente pelo phoneNumberId da conexão Meta
          const resolved = resolveClientByPhoneNumberId(phoneNumberId) ?? resolveClientFallback();
          const { clientId, funnelId } = resolved;
          const isNew = !getLeadByPhone(clientId, phone);

          upsertLeadByPhone(clientId, phone, {
            clientId, funnelId,
            name: pushName,
            phone,
            source: "whatsapp",
            adPlatform: referral ? "meta" : null,
            campaignName: referral?.headline ?? null,
            adId: referral?.ad_id ?? null,
            fbclid: null,
            status: isNew ? "novo" : undefined,
            notes: referral ? [
              referral.headline    && `Anúncio: ${referral.headline}`,
              referral.ad_id       && `Ad ID: ${referral.ad_id}`,
              referral.source_url  && `URL: ${referral.source_url}`,
              referral.source_type && `Tipo: ${referral.source_type}`,
            ].filter(Boolean).join("\n") : undefined,
          });

          console.log(`[Meta/CTWA] ${pushName} (${phone}) — cliente: ${clientId}${referral ? ` — anúncio: ${referral.headline}` : ""}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

