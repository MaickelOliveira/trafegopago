import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getClients, type Client } from "@/lib/clients";
import { upsertClient } from "@/lib/clients";
import { getLeads } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { getHistory } from "@/lib/conversations";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { classifyLeadByHistory } from "@/lib/kanban-agent";

// Classifica todos os leads (com conversa registrada) de UM cliente.
// Compartilhado entre o modo "um cliente" e o modo "plataforma inteira".
async function classifyClientLeads(client: Client): Promise<{ processed: number; moved: number; total: number; skipped?: string }> {
  const geminiApiKey = getGeminiApiKey(client.agentConfig?.geminiApiKey ?? undefined);
  if (!geminiApiKey) {
    return { processed: 0, moved: 0, total: 0, skipped: "Gemini API key não configurada" };
  }

  const leads = getLeads(client.id);
  let processed = 0;
  let moved = 0;

  // Processa em paralelo com limite de 5 simultâneos para não sobrecarregar a API
  const BATCH = 5;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (lead) => {
        const funnel = getFunnelById(lead.funnelId);
        if (!funnel) return;

        const history = getHistory(lead.realPhone ?? lead.phone, lead.clientId);
        if (history.length === 0) return;

        processed++;
        const wasMoved = await classifyLeadByHistory(history, lead, funnel, geminiApiKey, client);
        if (wasMoved) moved++;
      })
    );
  }

  return { processed, moved, total: leads.length };
}

// PATCH /api/crm/kanban-agent?clientId=xxx — liga ou desliga o agente Kanban
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId") ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  // Managers podem alterar qualquer cliente; clientes/funcionários só o próprio
  if (session.role !== "manager" && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const enabled: boolean = typeof body.enabled === "boolean" ? body.enabled : !client.kanbanAgentEnabled;
  const kanbanAgentPrompt: string | undefined =
    typeof body.kanbanAgentPrompt === "string" ? body.kanbanAgentPrompt : client.kanbanAgentPrompt;

  upsertClient({ ...client, kanbanAgentEnabled: enabled, kanbanAgentPrompt });

  return NextResponse.json({ ok: true, kanbanAgentEnabled: enabled, kanbanAgentPrompt });
}

// POST /api/crm/kanban-agent?clientId=xxx — classifica os leads de um cliente.
// Sem clientId, um manager classifica a PLATAFORMA INTEIRA (todos os clientes);
// um cliente/funcionário sem clientId classifica só o próprio (session.clientId).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const explicitClientId = req.nextUrl.searchParams.get("clientId");

  if (explicitClientId && session.role !== "manager" && session.clientId !== explicitClientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Modo plataforma inteira: só managers, e só quando nenhum clientId foi passado
  if (!explicitClientId && session.role === "manager") {
    const clients = getClients();
    let processed = 0;
    let moved = 0;
    let total = 0;
    const perClient: { clientId: string; name: string; processed: number; moved: number; skipped?: string }[] = [];

    for (const client of clients) {
      const result = await classifyClientLeads(client);
      processed += result.processed;
      moved += result.moved;
      total += result.total;
      perClient.push({ clientId: client.id, name: client.name, processed: result.processed, moved: result.moved, skipped: result.skipped });
    }

    return NextResponse.json({ ok: true, processed, moved, total, clients: perClient });
  }

  const clientId = explicitClientId ?? session.clientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const result = await classifyClientLeads(client);
  if (result.skipped) return NextResponse.json({ error: result.skipped }, { status: 400 });

  return NextResponse.json({ ok: true, processed: result.processed, moved: result.moved, total: result.total });
}
