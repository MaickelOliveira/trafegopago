import { NextRequest, NextResponse } from "next/server";
import { getLeadData } from "@/lib/tintim-api";
import { getClientById } from "@/lib/clients";
import { upsertSale } from "@/lib/sales";

type Body = Record<string, unknown>;

function extractPhone(body: Body): string | null {
  const candidates = [
    body.phone,
    (body.data as Body | undefined)?.phone,
    (body.lead as Body | undefined)?.phone,
    ((body.data as Body | undefined)?.lead as Body | undefined)?.phone,
    body.telephone,
    body.whatsapp,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.replace(/\D/g, "");
  }
  return null;
}

const SALE_KEYWORDS = [
  "comprou", "compra", "vend", "sale", "won", "fechado",
  "convertido", "pagou", "fechou", "cliente", "confirmado",
];

function isSaleEvent(body: Body): boolean {
  const text = JSON.stringify(body).toLowerCase();
  return SALE_KEYWORDS.some((kw) => text.includes(kw));
}

function derivePlatform(utmSource: string | null): "meta" | "google" | null {
  if (!utmSource) return null;
  const s = utmSource.toLowerCase();
  if (s.includes("google")) return "google";
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram")) return "meta";
  return null;
}

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId = searchParams.get("clientId");
  const secret = searchParams.get("secret");

  // Valida secret opcional
  const globalSecret = process.env.TINTIM_WEBHOOK_SECRET;
  if (globalSecret && secret !== globalSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Resolve credenciais e config do cliente
  let tintimCode: string | undefined;
  let tintimToken: string | undefined;
  let forwardUrl: string | undefined;
  let resolvedClientId: string | null = clientId;

  if (clientId) {
    const client = getClientById(clientId);
    if (!client) {
      return NextResponse.json({ ok: false, error: "client not found" }, { status: 404 });
    }
    tintimCode = client.tintimCode;
    tintimToken = client.tintimToken;
    forwardUrl = client.tintimWebhookForward;
  }

  // Fallback para variáveis de ambiente globais
  tintimCode ??= process.env.TINTIM_ACCOUNT_CODE;
  tintimToken ??= process.env.TINTIM_ACCOUNT_TOKEN;

  if (!tintimCode || !tintimToken) {
    console.error("[Tintim webhook] Credenciais não configuradas para clientId:", clientId);
    return NextResponse.json({ ok: true }); // 200 para evitar retentativas
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  console.log("[Tintim webhook] clientId=%s payload=%s", clientId, JSON.stringify(body).slice(0, 300));

  // Encaminha para a URL original (fire-and-forget — não bloqueia nem falha se der erro)
  if (forwardUrl) {
    fetch(forwardUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((err) => console.error("[Tintim proxy] Erro ao encaminhar para", forwardUrl, err));
  }

  try {
    if (!isSaleEvent(body)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const phone = extractPhone(body);
    if (!phone) return NextResponse.json({ ok: true });

    const lead = await getLeadData(phone, tintimCode, tintimToken);
    if (!lead) return NextResponse.json({ ok: true });

    const platform = derivePlatform(lead.utm_source);
    const today = new Date().toISOString().slice(0, 10);
    const id = `${resolvedClientId ?? "global"}-${phone}-${today}`;

    upsertSale({
      id,
      phone,
      clientId: resolvedClientId,
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

    console.log(`[Tintim] Venda salva: client=${resolvedClientId} phone=${phone} campanha=${lead.utm_campaign}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Tintim webhook] Erro:", err);
    return NextResponse.json({ ok: true });
  }
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  return NextResponse.json({
    status: "online",
    service: "Tintim webhook receiver",
    clientId: clientId ?? "global",
    timestamp: new Date().toISOString(),
  });
}
