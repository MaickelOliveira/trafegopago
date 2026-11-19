import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, patchClient } from "@/lib/clients";

// A movimentação automática exige ativação explícita para cada cliente.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId || session.role !== "manager" && session.clientId !== clientId) return NextResponse.json({ error: "Cliente não permitido." }, { status: 403 });
  const client = await getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.enabled !== "boolean" || body.kanbanAgentPrompt !== undefined && (typeof body.kanbanAgentPrompt !== "string" || body.kanbanAgentPrompt.length > 4000)) {
    return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  }
  await patchClient(client.id, {
    kanbanAgentEnabled: body.enabled,
    kanbanAgentPrompt: body.kanbanAgentPrompt ?? client.kanbanAgentPrompt,
  });
  return NextResponse.json({ ok: true, kanbanAgentEnabled: body.enabled, kanbanAgentPrompt: body.kanbanAgentPrompt ?? client.kanbanAgentPrompt });
}

// A antiga ação percorria todos os leads de todos os clientes e podia gerar
// centenas de chamadas à IA com um clique. A classificação segura ocorre
// somente com novas mensagens, para clientes que optaram por ativá-la.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ error: "A classificação em massa foi desativada para evitar gastos inesperados. A análise automática ocorre quando chegam novas mensagens." }, { status: 410 });
}
