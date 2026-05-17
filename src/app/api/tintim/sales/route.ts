import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSalesStatsByDateRange, getSales } from "@/lib/sales";

function presetToRange(preset: string): { since: string; until: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const until = fmt(today);
  const ago = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return fmt(d);
  };
  switch (preset) {
    case "today":        return { since: until, until };
    case "yesterday":    { const y = ago(1); return { since: y, until: y }; }
    case "last_7d":      return { since: ago(7), until };
    case "last_14d":     return { since: ago(14), until };
    case "last_30d":     return { since: ago(30), until };
    case "this_month":   return { since: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), until };
    case "last_month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last  = new Date(today.getFullYear(), today.getMonth(), 0);
      return { since: fmt(first), until: fmt(last) };
    }
    default:             return { since: "2020-01-01", until };
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("datePreset") ?? "last_30d";
  const clientId   = searchParams.get("clientId");
  const { since, until } = presetToRange(datePreset);

  const byCampaign = getSalesStatsByDateRange(since, until, clientId ?? undefined);

  const all = getSales().filter((s) => {
    const d = s.createdAt.slice(0, 10);
    if (d < since || d > until) return false;
    if (clientId && s.clientId !== clientId) return false;
    return true;
  });

  const totalCount   = all.length;
  const totalRevenue = all.reduce((s, r) => s + (r.saleAmount ?? 0), 0);

  return NextResponse.json({ byCampaign, totalCount, totalRevenue, since, until });
}
