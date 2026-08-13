import { NextRequest, NextResponse } from "next/server";
import { getDeviceByToken } from "@/lib/extension-devices";
import { getPendingReplies } from "@/lib/extension-outbox";
import { checkRateLimit } from "@/lib/rate-limit";

function deviceToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Buscada por polling do content-script (ver extension/src/content-script.ts)
 *  enquanto a aba do WhatsApp Web estiver aberta — é assim que uma resposta
 *  da IA gerada no servidor chega até o navegador do cliente pra ser enviada
 *  de verdade (o servidor não tem como "empurrar" nada pra um Chrome). */
export async function GET(req: NextRequest) {
  const token = deviceToken(req);
  if (!token) return NextResponse.json({ error: "Token ausente" }, { status: 401 });

  const device = getDeviceByToken(token);
  if (!device || device.status === "revoked") {
    return NextResponse.json({ error: "Dispositivo não autorizado" }, { status: 401 });
  }

  // Polling normal a cada ~5s — limite generoso só pra conter um loop com
  // defeito na extensão, não pro uso normal.
  if (!checkRateLimit(`pending-replies:${device.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const replies = getPendingReplies(device.id).map((r) => ({ id: r.id, chatId: r.chatId, text: r.text }));
  return NextResponse.json({ replies });
}
