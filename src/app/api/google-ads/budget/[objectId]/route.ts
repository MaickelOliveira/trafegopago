import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { updateCampaignBudget, formatGoogleAdsError } from "@/lib/google-ads-api";

type Params = { params: Promise<{ objectId: string }> };

// objectId aqui é o id do campaign_budget (GoogleCampaign.budgetResourceId),
// NÃO o id da campanha — no Google Ads orçamento é um recurso separado.
// Body: { budget: number (R$), accountId: string }. Só orçamento diário (v1).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { objectId } = await params;
  const { budget, accountId } = await req.json();

  if (!budget || budget <= 0) {
    return NextResponse.json({ error: "Orçamento inválido" }, { status: 400 });
  }
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const creds = getGoogleAdsCreds();
  if (!creds) return NextResponse.json({ error: "Google Ads não configurado" }, { status: 500 });

  try {
    await updateCampaignBudget(creds, accountId, objectId, budget);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: formatGoogleAdsError(e) }, { status: 400 });
  }
}
