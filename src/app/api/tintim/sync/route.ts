import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getLeadData, getLeadStatuses } from "@/lib/tintim-api";
import { upsertSale } from "@/lib/sales";

const SALE_KEYWORDS = ["comprou", "compra", "vend", "sale", "won", "fechado", "convertido", "pagou", "fechou", "confirmado"];

function looksLikeSale(name: string): boolean {
  const n = name.toLowerCase();
  return SALE_KEYWORDS.some((kw) => n.includes(kw));
}

function derivePlatform(utmSource: string | null): "meta" | "google" | null {
  if (!utmSource) return null;
  const s = utmSource.toLowerCase();
  if (s.includes("google")) return "google";
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram")) return "meta";
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const clientId = searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client?.tintimCode || !client?.tintimToken) {
    return NextResponse.json({ error: "Tintim não configurado para este cliente" }, { status: 400 });
  }

  const { code, token } = { code: client.tintimCode, token: client.tintimToken };

  let phones: string[] = [];
  try {
    const body = await req.json();
    phones = (body.phones as string[])
      .map((p: string) => p.replace(/\D/g, ""))
      .filter((p: string) => p.length >= 10);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (phones.length === 0) {
    return NextResponse.json({ error: "Nenhum telefone válido fornecido" }, { status: 400 });
  }

  // Busca os status de venda do cliente no Tintim
  const statuses = await getLeadStatuses(code, token);
  const saleStatusIds = new Set(
    statuses.filter((s) => looksLikeSale(s.name)).map((s) => s.id)
  );

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const phone of phones) {
    try {
      const lead = await getLeadData(phone, code, token);
      if (!lead) { skipped++; continue; }

      const isSale = lead.status
        ? saleStatusIds.has(lead.status.id) || looksLikeSale(lead.status.name)
        : false;

      if (!isSale) { skipped++; continue; }

      const platform = derivePlatform(lead.utm_source);
      const saleDate = lead.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

      upsertSale({
        id: `${clientId}-${phone}-${saleDate}`,
        phone,
        clientId,
        platform,
        utmSource: lead.utm_source,
        utmMedium: lead.utm_medium,
        utmCampaign: lead.utm_campaign,
        utmContent: lead.utm_content,
        utmTerm: lead.utm_term,
        saleAmount: lead.sale_amount,
        statusName: lead.status?.name ?? null,
        createdAt: lead.created_at ?? new Date().toISOString(),
      });
      synced++;
    } catch {
      errors.push(phone);
    }
  }

  return NextResponse.json({ synced, skipped, errors, total: phones.length });
}
