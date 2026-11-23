import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import type { AvisoRecipient } from "@/lib/clients";
import { getHistory } from "@/lib/conversations";
import { sendMessage } from "@/lib/whatsapp-send";

// POST /api/agent/summary?clientId=xxx&phone=xxx
// Envia resumo da conversa para todos os destinatários de avisos configurados
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

  const client = (await getClientById(clientId));
  const connId = req.nextUrl.searchParams.get("connId") ?? undefined;
  const agentCfg = client ? getAgentConfigForConnection(client, connId) : undefined;

  // Usa avisos[] com fallback para summaryPhone legado
  const recipients: AvisoRecipient[] = agentCfg?.avisos?.length
    ? agentCfg.avisos
    : agentCfg?.summaryPhone
      ? [{ id: "legacy", label: "Gestor", value: agentCfg.summaryPhone, type: "phone" }]
      : [];

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Nenhum destinatário de avisos configurado" }, { status: 400 });
  }

  const history = (await getHistory(phone, clientId, connId));
  if (history.length === 0) {
    return NextResponse.json({ error: "Sem conversa para resumir" }, { status: 400 });
  }

  const lines = history.slice(-20).map(
    (m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`
  ).join("\n");

  const summary = `📋 *Resumo de conversa — ${client?.name}*\n\n📞 Número: ${phone}\n\n${lines}`;

  await Promise.all(recipients.map(r => sendMessage(r.value, summary, clientId, connId)));

  return NextResponse.json({ ok: true });
}
