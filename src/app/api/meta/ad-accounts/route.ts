import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

type RawAccount = { id: string; name: string; account_id: string };
type RawBusiness = { id: string; name: string };

async function fetchAccounts(url: string): Promise<RawAccount[]> {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error || !data.data) return [];
  return data.data as RawAccount[];
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const token = getConfig().metaToken;
  if (!token) {
    return NextResponse.json({ error: "Token Meta não configurado" }, { status: 400 });
  }

  const base = `https://graph.facebook.com/v19.0`;
  const accountFields = `fields=id,name,account_id&limit=200&access_token=${token}`;

  // 1. Contas diretas do usuário
  const directAccounts = await fetchAccounts(`${base}/me/adaccounts?${accountFields}`);

  // 2. Busca todas as BMs que o usuário administra
  const bizRes = await fetch(`${base}/me/businesses?fields=id,name&limit=50&access_token=${token}`);
  const bizData = await bizRes.json();
  const businesses: RawBusiness[] = bizData.data ?? [];

  // 3. Para cada BM, busca contas próprias e contas de clientes
  const bmAccountArrays = await Promise.all(
    businesses.flatMap((biz) => [
      fetchAccounts(`${base}/${biz.id}/owned_ad_accounts?${accountFields}`),
      fetchAccounts(`${base}/${biz.id}/client_ad_accounts?${accountFields}`),
    ])
  );

  // 4. Junta tudo e remove duplicatas pelo account_id
  const all = [...directAccounts, ...bmAccountArrays.flat()];
  const seen = new Set<string>();
  const unique = all.filter((a) => {
    if (seen.has(a.account_id)) return false;
    seen.add(a.account_id);
    return true;
  });

  const accounts = unique.map((a) => ({
    id: `act_${a.account_id}`,
    name: a.name,
    platform: "meta" as const,
  }));

  return NextResponse.json(accounts);
}
