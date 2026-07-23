import { NextRequest, NextResponse } from "next/server";
import { getClientById, getAllAgentConfigs, saveClients, getClients } from "@/lib/clients";

export const dynamic = "force-dynamic";

/**
 * Rota de debug one-off para ler/editar o systemPrompt de um agente específico
 * diretamente em produção (equivalente ao que o usuário faria colando manualmente
 * na tela de Agente IA do Gestor). Não é uma rota de uso contínuo.
 *
 * GET  sem clientId          -> lista {id, name} de todos os clientes
 * GET  ?clientId=X           -> lista {name, whatsappConnectionId, systemPrompt} dos agentConfigs desse cliente
 * PUT  ?clientId=X&agentName=Y  body: { systemPrompt: string } -> substitui o systemPrompt do agente cujo name === agentName
 */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    const clients = getClients().map((c) => ({ id: c.id, name: c.name }));
    return NextResponse.json({ clients });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const agents = getAllAgentConfigs(client).map((cfg) => ({
    name: cfg.name,
    whatsappConnectionId: cfg.whatsappConnectionId,
    systemPrompt: cfg.systemPrompt ?? "",
  }));

  return NextResponse.json({ clientId, agents });
}

export async function PUT(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const agentName = req.nextUrl.searchParams.get("agentName");
  if (!clientId || !agentName) {
    return NextResponse.json({ error: "clientId e agentName obrigatórios" }, { status: 400 });
  }

  const body = await req.json();
  const newPrompt: string = body.systemPrompt ?? "";

  const clients = getClients();
  const client = clients.find((c) => c.id === clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  let updated = false;
  if (client.agentConfig?.name === agentName) {
    client.agentConfig.systemPrompt = newPrompt;
    updated = true;
  }
  if (client.agentConfigs?.length) {
    for (const cfg of client.agentConfigs) {
      if (cfg.name === agentName) {
        cfg.systemPrompt = newPrompt;
        updated = true;
      }
    }
  }

  if (!updated) return NextResponse.json({ error: `agente "${agentName}" não encontrado` }, { status: 404 });

  saveClients(clients);
  return NextResponse.json({ ok: true });
}
