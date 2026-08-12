import { NextRequest, NextResponse } from "next/server";
import { getDeviceByToken } from "@/lib/extension-devices";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { addMessage } from "@/lib/conversations";
import { checkRateLimit } from "@/lib/rate-limit";

type IncomingItem = { phone: string | null; contactName: string | null; lastMessagePreview: string | null };

function deviceToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Chamada pelo service worker da extensão quando o content script detecta
 *  prévia de mensagem nova numa conversa. Reaproveita a MESMA função de
 *  upsert de lead que o webhook da Evolution API usa (src/lib/leads.ts) —
 *  mesmo comportamento de CRM pros dois canais, como pedido. */
export async function POST(req: NextRequest) {
  const token = deviceToken(req);
  if (!token) return NextResponse.json({ error: "Token ausente" }, { status: 401 });

  const device = getDeviceByToken(token);
  if (!device || device.status === "revoked") {
    return NextResponse.json({ error: "Dispositivo não autorizado" }, { status: 401 });
  }

  // Tráfego normal (não é alvo de força bruta como /claim) — limite generoso
  // só pra conter um loop com defeito na extensão, não pro uso normal.
  if (!checkRateLimit(`messages:${device.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { items?: IncomingItem[] } | null;
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "items obrigatório" }, { status: 400 });
  }

  // Resolve a coluna de entrada do funil uma única vez (mesmo padrão do
  // webhook Evolution: src/app/api/whatsapp/webhook/evolution/[token]/route.ts).
  const funnel = device.funnelId ? getFunnelById(device.funnelId) : undefined;
  const entradaColumnId = funnel?.columns?.[0]?.id ?? "entrada";

  let processed = 0;
  let skipped = 0;

  for (const item of body.items.slice(0, 50)) {
    // Sem telefone extraído, não dá pra usar como chave de identidade do
    // lead com segurança (ver whatsapp-dom-adapter.ts) — pula em vez de
    // arriscar colidir leads diferentes numa chave sintética.
    if (!item.phone) { skipped++; continue; }

    const isNew = !getLeadByPhone(device.clientId, item.phone, device.funnelId);

    upsertLeadByPhone(device.clientId, item.phone, {
      clientId: device.clientId,
      funnelId: device.funnelId ?? "default",
      source: "whatsapp",
      ...(item.contactName ? { name: item.contactName } : {}),
      ...(isNew ? { status: entradaColumnId } : {}),
    });

    if (item.lastMessagePreview) {
      addMessage(
        item.phone,
        { role: "user", content: item.lastMessagePreview, ts: Date.now() },
        device.clientId,
        { connId: device.id, contactName: item.contactName ?? undefined }
      );
    }

    processed++;
  }

  return NextResponse.json({ ok: true, processed, skipped });
}
