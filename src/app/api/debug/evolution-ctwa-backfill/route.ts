import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { getEvolutionSessionByName } from "@/lib/evolution-sessions";
import { getLeadByPhone, updateLead } from "@/lib/leads";
import { getConfig } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "debug-evolution-webhook-payloads.json");

type DebugEntry = {
  phone: string;
  instance: string;
  dataContextInfo?: { externalAdReply?: Record<string, unknown>; externalAdReplyInfo?: Record<string, unknown> } | null;
};

/**
 * Backfill único: reprocessa os payloads brutos já capturados em
 * debug-evolution-webhook-payloads.json (via /api/debug/evolution-ctwa) e
 * aplica os dados de anúncio (adId/campaignName/etc.) em leads que já
 * existiam ANTES da correção do CTWa (route.ts do webhook Evolution), sem
 * precisar que o lead mande outra mensagem.
 */
export async function POST() {
  if (!existsSync(FILE)) {
    return NextResponse.json({ error: "Nenhum payload capturado ainda." }, { status: 404 });
  }

  const payloads = JSON.parse(readFileSync(FILE, "utf-8")) as DebugEntry[];
  const cfg = getConfig();
  const results: Record<string, unknown>[] = [];

  for (const p of payloads) {
    const externalAd = p.dataContextInfo?.externalAdReply ?? p.dataContextInfo?.externalAdReplyInfo;
    const sourceId = (externalAd?.sourceId ?? externalAd?.source_id) as string | undefined;
    if (!sourceId) continue;

    const session = getEvolutionSessionByName(p.instance);
    if (!session?.clientId) {
      results.push({ phone: p.phone, instance: p.instance, skipped: "sessão/cliente não encontrado" });
      continue;
    }

    const lead = getLeadByPhone(session.clientId, p.phone);
    if (!lead) {
      results.push({ phone: p.phone, instance: p.instance, skipped: "lead não encontrado" });
      continue;
    }

    if (lead.adId === sourceId) {
      results.push({ phone: p.phone, instance: p.instance, skipped: "lead já tinha esse adId" });
      continue;
    }

    if (!cfg.metaToken) {
      results.push({ phone: p.phone, instance: p.instance, skipped: "metaToken não configurado" });
      continue;
    }

    const adInfo = await getAdInfoById(sourceId, cfg.metaToken);
    const sourceUrl = (externalAd?.sourceUrl ?? externalAd?.source_url) as string | undefined;
    const title = externalAd?.title as string | undefined;

    const updated = updateLead(lead.id, {
      adPlatform: "meta",
      adId: adInfo?.adId ?? sourceId,
      adName: adInfo?.adName ?? null,
      adSetId: adInfo?.adSetId ?? null,
      adSetName: adInfo?.adSetName ?? null,
      campaignId: adInfo?.campaignId ?? null,
      campaignName: adInfo?.campaignName ?? title ?? null,
      adSourceUrl: sourceUrl ?? null,
    });

    results.push({
      phone: p.phone,
      instance: p.instance,
      leadId: lead.id,
      updated: !!updated,
      campaignName: updated?.campaignName ?? null,
      adName: updated?.adName ?? null,
    });
  }

  return NextResponse.json({ count: results.length, results });
}
