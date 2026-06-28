import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { updateCampaignStatus, updateAdGroupStatus, updateAdStatus, formatGoogleAdsError } from "@/lib/google-ads-api";

type Params = { params: Promise<{ objectId: string }> };

// Body: { status: "ACTIVE"|"PAUSED", accountId: string, entityType?: "campaign"|"ad_group"|"ad", adGroupId?: string }
// accountId é necessário pois a lib do Google Ads precisa do customer_id pra
// montar o Customer (diferente da Meta, cujo PATCH não depende da conta).
// adGroupId é exigido quando entityType === "ad" (resource name de anúncio
// no Google Ads precisa do id do ad group junto com o id do anúncio).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { objectId } = await params;
  const { status, accountId, entityType, adGroupId } = await req.json();

  if (status !== "ACTIVE" && status !== "PAUSED") {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const creds = getGoogleAdsCreds();
  if (!creds) return NextResponse.json({ error: "Google Ads não configurado" }, { status: 500 });

  try {
    if (entityType === "ad_group") {
      await updateAdGroupStatus(creds, accountId, objectId, status);
    } else if (entityType === "ad") {
      if (!adGroupId) return NextResponse.json({ error: "adGroupId obrigatório" }, { status: 400 });
      await updateAdStatus(creds, accountId, adGroupId, objectId, status);
    } else {
      await updateCampaignStatus(creds, accountId, objectId, status);
    }
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json({ error: formatGoogleAdsError(e) }, { status: 400 });
  }
}
