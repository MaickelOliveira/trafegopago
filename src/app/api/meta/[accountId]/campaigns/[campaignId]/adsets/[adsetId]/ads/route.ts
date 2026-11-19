import { metaObjectBelongsToAccount } from "@/lib/ad-account-access";
import { signedAdAssetPath } from "@/lib/ad-media-access";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, getClientById } from "@/lib/clients";
import { getAds } from "@/lib/meta-api";

type Params = { params: Promise<{ accountId: string; adsetId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId, adsetId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  if (session.role === "client") {
    const client = (await getClientById(session.clientId!));
    if (!client?.adAccounts.some((a) => a.id === accountId)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const token = (await getConfig()).metaToken;
  if (session.role !== "manager" && !await metaObjectBelongsToAccount(adsetId,accountId,token)) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset") || "last_30d";

  try {
    const ads = await getAds(adsetId, token, datePreset);
    if(session.role==="client") for(const ad of ads)if(ad.creative){
      if(ad.creative.videoId)ad.creative.videoPreviewUrl=signedAdAssetPath("video",ad.creative.videoId,accountId,session.clientId!);
      if(ad.creative.igMediaId)ad.creative.igPreviewUrl=signedAdAssetPath("ig",ad.creative.igMediaId,accountId,session.clientId!);
    }
    return NextResponse.json(ads);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
