import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getHistory } from "@/lib/conversations";
import { sendMessage } from "@/lib/whatsapp-send";

// POST /api/agent/summary?clientId=xxx&phone=xxx
// Envia resumo da conversa para summaryPhone configurado
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  const phone = req.nextUrl.searchParams.get("phone");

  if (!clientId || !phone) {
    return NextResponse.json({ error: "clientId e phone obrigatórios" }, { status: 400 });
  }

  const client = getClientById(clientId);
  const summaryPhone = client?.agentConfig?.summaryPhone;
  if (!summaryPhone) {
    return NextResponse.json({ error: "Número de resumo não configurado" }, { status: 400 });
  }

  const history = getHistory(phone);
  if (history.length === 0) {
    return NextResponse.json({ error: "Sem conversa para resumir" }, { status: 400 });
  }

  const lines = history.slice(-20).map(
    (m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`
  ).join("\n");

  const summary = `📋 *Resumo de conversa — ${client?.name}*\n\n📞 Número: ${phone}\n\n${lines}`;

  await sendMessage(summaryPhone, summary, clientId);

  return NextResponse.json({ ok: true });
}
