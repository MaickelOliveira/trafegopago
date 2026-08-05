import { NextResponse } from "next/server";
import { getLeads, updateLead } from "@/lib/leads";
import { getConfig } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";

export const dynamic = "force-dynamic";

/**
 * Backfill genérico: encontra leads com adId salvo mas campaignId ainda
 * ausente (presos no fallback de headline por uma falha antiga na Graph API
 * — token errado, rate limit, erro transitório) e refaz a chamada
 * getAdInfoById pra completar Conjunto/Anúncio/Campaign ID sem esperar o
 * lead mandar outra mensagem. Cobre todos os canais (UazapiGO, Evolution,
 * WPPConnect, Meta Cloud API), já que todos gravam nos mesmos campos do Lead.
 *
 * POST /api/debug/meta-ad-backfill          — roda em todos os clientes
 * POST /api/debug/meta-ad-backfill?clientId=vitalli-garden — só um cliente
 */
// Chamada direta à Graph API (bypassa getAdInfoById) só pra este endpoint de
// diagnóstico conseguir devolver o texto real do erro na resposta — a versão
// usada pelos webhooks engole o erro (só console.warn) porque ali só importa
// o resultado, não a causa; aqui a causa é o que precisamos ver.
async function fetchRawAdError(adId: string, token: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/v19.0/${adId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "name,adset_id,campaign_id,adset{id,name,campaign{id,name}}");
  try {
    const res = await fetch(url.toString());
    const bodyText = await res.text();
    return `HTTP ${res.status}: ${bodyText.slice(0, 500)}`;
  } catch (e) {
    return `fetch falhou: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function POST(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? undefined;
  const cfg = getConfig();
  if (!cfg.metaToken) {
    return NextResponse.json({ error: "metaToken não configurado em config.json" }, { status: 400 });
  }

  const leads = getLeads(clientId).filter(
    (l) => l.adPlatform === "meta" && !!l.adId && !l.campaignId,
  );

  const results: Record<string, unknown>[] = [];
  for (const lead of leads) {
    const adInfo = await getAdInfoById(lead.adId!, cfg.metaToken);
    if (!adInfo) {
      const rawError = await fetchRawAdError(lead.adId!, cfg.metaToken);
      results.push({ leadId: lead.id, phone: lead.phone, clientId: lead.clientId, adId: lead.adId, updated: false, reason: rawError });
      continue;
    }
    const updated = updateLead(lead.id, {
      adName: adInfo.adName,
      adSetId: adInfo.adSetId,
      adSetName: adInfo.adSetName,
      campaignId: adInfo.campaignId,
      campaignName: adInfo.campaignName,
    });
    results.push({
      leadId: lead.id,
      phone: lead.phone,
      clientId: lead.clientId,
      adId: lead.adId,
      updated: !!updated,
      campaignName: updated?.campaignName ?? null,
      adSetName: updated?.adSetName ?? null,
    });
  }

  return NextResponse.json({ candidatos: leads.length, results });
}
