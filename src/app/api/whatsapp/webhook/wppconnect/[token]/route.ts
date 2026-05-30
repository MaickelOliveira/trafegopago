import { NextRequest, NextResponse } from "next/server";
import { getWppSessionById } from "@/lib/wppconnect-sessions";
import { getFunnels } from "@/lib/funnels";
import { getLeadByPhone, upsertLeadByPhone } from "@/lib/leads";
import { getConfig } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Identifica a sessão pelo UUID
  const wppSession = getWppSessionById(token);
  if (!wppSession || !wppSession.funnelId) {
    return NextResponse.json({ ok: true }); // ignora sessões sem funil
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // WPPConnect envia event = "onmessage" ou outros eventos
  const event = (body.event as string ?? "").toLowerCase();
  if (event !== "onmessage" && event !== "onanyMessage" && event !== "message") {
    return NextResponse.json({ ok: true });
  }

  const data = body.data as Record<string, unknown> | undefined;
  if (!data) return NextResponse.json({ ok: true });

  const fromMe = data.fromMe === true || data.self === "out";

  // Ignora mensagens enviadas por nós
  if (fromMe) return NextResponse.json({ ok: true });

  // Ignora grupos
  const isGroupMsg = data.isGroupMsg === true || String(data.from ?? "").endsWith("@g.us");
  if (isGroupMsg) return NextResponse.json({ ok: true });

  // Extrai o número do remetente
  const rawFrom = (data.from as string) ?? (data.chatId as string) ?? "";
  const phone = rawFrom.replace(/@.*/, "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ ok: true });

  // Extrai o texto da mensagem
  const text = (data.body as string) || (data.caption as string) || "";

  // Extrai o nome do contato
  const sender = data.sender as Record<string, unknown> | undefined;
  const pushName = (sender?.pushname as string) || (data.notifyName as string) || phone;

  // ── CTWa: referral data (Click-to-WhatsApp) ──
  // WPPConnect expõe dados de anúncio no campo `referral`
  const referral = data.referral as Record<string, unknown> | undefined;
  const ctwaAdId      = referral?.source_id as string | undefined;
  const ctwaSourceUrl = referral?.source_url as string | undefined;
  const ctwaHeadline  = referral?.headline as string | undefined;

  // Encontra o funil vinculado
  const funnels = getFunnels();
  const funnel = funnels.find(f => f.id === wppSession.funnelId);
  const funnelId = funnel?.id ?? wppSession.funnelId!;
  const clientId = funnel?.clientId ?? "sem-cliente";
  const entradaColumnId = funnel?.columns?.[0]?.id ?? "entrada";

  const existingLead = getLeadByPhone(clientId, phone);
  const isNew = !existingLead;
  const shouldUpdateName = isNew || existingLead?.name === phone;

  // ── Lookup no Meta Ads API para enriquecer dados de campanha ──
  let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
  if (isNew && ctwaAdId) {
    try {
      const cfg = getConfig();
      if (cfg.metaToken) {
        adInfo = await getAdInfoById(ctwaAdId, cfg.metaToken);
      }
    } catch { /* best-effort */ }
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
        adSourceUrl: ctwaSourceUrl ?? null,
      }
    : ctwaAdId || ctwaHeadline
    ? {
        adPlatform: "meta" as const,
        adId: ctwaAdId ?? null,
        campaignName: ctwaHeadline ?? null,
        adSourceUrl: ctwaSourceUrl ?? null,
      }
    : {};

  upsertLeadByPhone(clientId, phone, {
    clientId,
    funnelId,
    source: "whatsapp",
    ...(shouldUpdateName ? { name: pushName } : {}),
    ...(isNew ? { status: entradaColumnId } : {}),
    ...adFields,
  });

  if (ctwaAdId) {
    console.log(`[WPPConnect Webhook] CTWa lead phone=${phone} adId=${ctwaAdId} adInfo=${JSON.stringify(adInfo)}`);
  }

  return NextResponse.json({ ok: true });
}
