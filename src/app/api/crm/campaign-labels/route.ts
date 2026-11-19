import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getConfig } from "@/lib/clients";
import { getLeads } from "@/lib/leads";
import { getEmployeeById, employeeCanAccessFunnel } from "@/lib/employees";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { getCampaignLabels as metaLabels } from "@/lib/meta-api";
import { getCampaignLabels as googleLabels } from "@/lib/google-ads-api";
import { campaignLabel, type CampaignCatalog } from "@/lib/campaign-label";

export const dynamic = "force-dynamic";
type CatalogResult = { catalog: CampaignCatalog; partial: boolean };
const cache = new Map<string, { expires: number; value: Promise<CatalogResult> }>();

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entre na sua conta." }, { status: 401 });
  const clientId = request.nextUrl.searchParams.get("clientId") || session.clientId;
  if (!clientId || session.role !== "manager" && clientId !== session.clientId) return NextResponse.json({ error: "Cliente não permitido." }, { status: 403 });
  const client = await getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  let leads = await getLeads(clientId);
  if (session.role === "employee") {
    const employee = await getEmployeeById(session.employeeId!);
    leads = employee ? leads.filter(lead => employeeCanAccessFunnel(employee, lead.funnelId)) : [];
  }
  if (!leads.length) return NextResponse.json({ labels: {}, partial: false });
  const accounts = client.adAccounts.map(account => ({...account, id: account.platform === "google" ? account.id.replace(/-/g, "") : account.id})).filter(account => /^(?:act_)?\d+$/.test(account.id) && ["meta", "google"].includes(account.platform));
  const key = `${clientId}:${accounts.map(account => `${account.platform}:${account.id}`).sort().join(",")}`;
  let entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if (cache.size > 200) cache.clear();
    const value = (async () => {
      const config = await getConfig();
      const google = await getGoogleAdsCreds();
      const catalog: CampaignCatalog = {};
      const results = await Promise.allSettled(accounts.map(async account => {
        const rows = account.platform === "meta" && config.metaToken ? await metaLabels(account.id, config.metaToken)
          : account.platform === "google" && google ? await googleLabels(google, account.id) : null;
        if (!rows) throw Error("Integration not configured");
        return { platform: account.platform, rows };
      }));
      for (const result of results) if (result.status === "fulfilled") {
        const map = catalog[result.value.platform] ??= {};
        for (const row of result.value.rows) map[row.id] = row.id in map && map[row.id] !== row.name ? null : row.name;
      }
      return { catalog, partial: results.some(result => result.status === "rejected") };
    })();
    entry = { expires: Date.now() + 600000, value };
    cache.set(key, entry);
    void value.then(result => { if (result.partial) entry!.expires = Date.now() + 60000; }).catch(() => { entry!.expires = Date.now() + 60000; });
  }
  try {
    const { catalog, partial } = await entry.value;
    const labels: Record<string, string> = {};
    for (const lead of leads) { const label = campaignLabel(lead, catalog); if (label) labels[lead.id] = label; }
    return NextResponse.json({ labels, partial }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ labels: {}, partial: true }, { headers: { "Cache-Control": "private, no-store" } }); }
}
