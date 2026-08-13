import { NextRequest, NextResponse } from "next/server";
import { getDeviceByToken } from "@/lib/extension-devices";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { addMessage, getHistory } from "@/lib/conversations";
import { getConfig } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";
import { checkRateLimit } from "@/lib/rate-limit";

type IncomingItem = {
  phone: string;
  contactName: string | null;
  body: string;
  ts: number;
  adId: string | null;
  adSourceUrl: string | null;
  adTitle: string | null;
};

function deviceToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Chamada pelo service worker da extensão quando main-world.ts (via
 *  @wppconnect/wa-js) detecta uma mensagem nova de verdade — não mais uma
 *  prévia raspada do DOM. Reaproveita a MESMA função de upsert de lead que o
 *  webhook da Evolution API usa (src/lib/leads.ts), incluindo o mesmo
 *  reaproveitamento de lead entre funis quando já existe histórico nesta
 *  conexão, e o mesmo enriquecimento de campanha via Graph API quando a
 *  mensagem carrega contexto de anúncio (CTWa). */
export async function POST(req: NextRequest) {
  const token = deviceToken(req);
  if (!token) return NextResponse.json({ error: "Token ausente" }, { status: 401 });

  const device = getDeviceByToken(token);
  if (!device || device.status === "revoked") {
    return NextResponse.json({ error: "Dispositivo não autorizado" }, { status: 401 });
  }

  // Tráfego normal (não é alvo de força bruta como /claim) — limite generoso
  // só pra conter um loop com defeito na extensão, não pro uso normal.
  if (!checkRateLimit(`messages:${device.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { items?: IncomingItem[] } | null;
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "items obrigatório" }, { status: 400 });
  }

  // Sem funil vinculado ainda (o gestor vincula depois de conectar — ver
  // /api/integrations/whatsapp-extension/link), ignora silenciosamente.
  // Mesmo comportamento do webhook Evolution pra sessão sem funil: nunca
  // grava lead com um funnelId inválido/inexistente.
  if (!device.funnelId) {
    return NextResponse.json({ ok: true, processed: 0, skipped: body.items.length, reason: "no_funnel_linked" });
  }

  const funnel = getFunnelById(device.funnelId);
  if (!funnel) {
    return NextResponse.json({ ok: true, processed: 0, skipped: body.items.length, reason: "funnel_not_found" });
  }
  const defaultFunnelId = funnel.id;
  const clientId = device.clientId;
  const entradaColumnId = funnel.columns?.[0]?.id ?? "entrada";
  const cfg = getConfig();

  let processed = 0;
  let skipped = 0;

  for (const item of body.items.slice(0, 50)) {
    if (!item.phone || !item.body) { skipped++; continue; }

    // Reaproveita lead existente do mesmo telefone em outro funil quando já
    // existe histórico nesta MESMA conexão (mesmo padrão do webhook Evolution)
    // — evita duplicar o lead de alguém que já conversou por outro canal.
    const leadInDefaultFunnel = getLeadByPhone(clientId, item.phone, defaultFunnelId);
    const leadElsewhere = leadInDefaultFunnel ? null : getLeadByPhone(clientId, item.phone);
    const hasHistoryOnThisConn = !!leadElsewhere && getHistory(item.phone, clientId, device.id).length > 0;
    const existingLead = leadInDefaultFunnel ?? (hasHistoryOnThisConn ? leadElsewhere : null);
    const isNew = !existingLead;
    const funnelId = existingLead?.funnelId ?? defaultFunnelId;

    // ── Contexto de anúncio (CTWa) — só presente quando a mensagem veio de
    // um clique em anúncio Meta, capturado por main-world.ts via wa-js. ──
    const alreadyAttributed = !!item.adId && existingLead?.adId === item.adId && !!existingLead?.campaignId;
    let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
    if (item.adId && !alreadyAttributed && cfg.metaToken) {
      adInfo = await getAdInfoById(item.adId, cfg.metaToken).catch(() => null);
    }
    const adFields = adInfo
      ? {
          adPlatform: "meta" as const,
          adId: adInfo.adId,
          adName: adInfo.adName,
          adSetId: adInfo.adSetId,
          adSetName: adInfo.adSetName,
          campaignId: adInfo.campaignId,
          campaignName: adInfo.campaignName,
          adSourceUrl: item.adSourceUrl ?? null,
        }
      : alreadyAttributed
      ? {}
      : item.adId || item.adTitle || item.adSourceUrl
      ? {
          adPlatform: "meta" as const,
          adId: item.adId ?? null,
          adName: null,
          adSetId: null,
          adSetName: null,
          campaignId: null,
          campaignName: item.adTitle ?? null,
          adSourceUrl: item.adSourceUrl ?? null,
        }
      : {};

    upsertLeadByPhone(clientId, item.phone, {
      clientId,
      funnelId,
      source: "whatsapp",
      ...(item.contactName ? { name: item.contactName } : {}),
      ...(isNew ? { status: entradaColumnId } : {}),
      ...adFields,
    });

    addMessage(
      item.phone,
      { role: "user", content: item.body, ts: item.ts },
      clientId,
      { connId: device.id, contactName: item.contactName ?? undefined }
    );

    processed++;
  }

  return NextResponse.json({ ok: true, processed, skipped });
}
