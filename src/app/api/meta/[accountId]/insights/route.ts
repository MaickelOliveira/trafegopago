import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, getClientById } from "@/lib/clients";
import { getAccountInsights, getAccountInsightsRange, getDailyInsights } from "@/lib/meta-api";

type Params = { params: Promise<{ accountId: string }> };

async function authorize(accountId: string) {
  const session = await getSession();
  if (!session) return null;

  if (session.role === "manager") return getConfig().metaToken;

  const client = getClientById(session.clientId!);
  const owns = client?.adAccounts.some((a) => a.id === accountId);
  if (!owns) return null;
  return getConfig().metaToken;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { accountId } = await params;
  const token = await authorize(accountId);
  if (!token) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset");
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const daily = searchParams.get("daily") === "1";

  try {
    if (daily && since && until) {
      const data = await getDailyInsights(accountId, token, since, until);
      return NextResponse.json(data);
    }
    if (since && until) {
      const data = await getAccountInsightsRange(accountId, token, since, until);
      return NextResponse.json(data);
    }
    const data = await getAccountInsights(accountId, token, datePreset || "last_30d");
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
