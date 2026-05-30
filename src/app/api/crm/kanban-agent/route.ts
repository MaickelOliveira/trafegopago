import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import { getLeads } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { getHistory } from "@/lib/conversations";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { classifyLeadByHistory } from "@/lib/kanban-agent";

// PATCH /api/crm/kanban-agent?clientId=xxx — liga ou desliga o agente Kanban
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const enabled: boolean = typeof body.enabled === "boolean" ? body.enabled : !client.kanbanAgentEnabled;

  upsertClient({ ...client, kanbanAgentEnabled: enabled });

  return NextResponse.json({ ok: true, kanbanAgentEnabled: enabled });
}

// POST /api/crm/kanban-agent?clientId=xxx — classifica todos os leads existentes
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const geminiApiKey = getGeminiApiKey(client.agentConfig?.geminiApiKey ?? undefined);
  if (!geminiApiKey) return NextResponse.json({ error: "Gemini API key não configurada" }, { status: 400 });

  const leads = getLeads(clientId);
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

        const history = getHistory(lead.realPhone ?? lead.phone);
        if (history.length === 0) return;

        processed++;
        const wasMoved = await classifyLeadByHistory(
          history,
          lead,
          funnel,
          geminiApiKey,
          client
        );
        if (wasMoved) moved++;
      })
    );
  }

  return NextResponse.json({ ok: true, processed, moved, total: leads.length });
}
