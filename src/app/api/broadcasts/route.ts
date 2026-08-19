import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getLeads, toDialablePhone } from "@/lib/leads";
import { createBroadcast, getBroadcasts } from "@/lib/broadcasts";
import { createBroadcastItems } from "@/lib/broadcast-items";

// Piso do delay configurável pela campanha — não pode ser menor que o
// intervalo do tick que processa a fila (instrumentation.ts, 5s), senão o
// delay pedido pelo usuário nunca teria efeito prático nenhum.
const MIN_DELAY_SECONDS = 5;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = session.role === "client"
    ? session.clientId
    : (req.nextUrl.searchParams.get("clientId") ?? undefined);
  if (!clientId) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  return NextResponse.json(getBroadcasts(clientId));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, name, message, connectionId, delaySeconds, funnelId, columnId, manualPhones } = body as {
    clientId?: string; name?: string; message?: string; connectionId?: string; delaySeconds?: number;
    funnelId?: string; columnId?: string; manualPhones?: string[];
  };

  if (!clientId || !name?.trim() || !message?.trim() || !connectionId) {
    return NextResponse.json({ error: "clientId, name, message e connectionId são obrigatórios" }, { status: 400 });
  }

  // Clientes e funcionários só podem criar campanhas para o seu próprio clientId
  if (session.role !== "manager" && session.clientId && session.clientId !== clientId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!delaySeconds || delaySeconds < MIN_DELAY_SECONDS) {
    return NextResponse.json({ error: `delaySeconds precisa ser no mínimo ${MIN_DELAY_SECONDS}s` }, { status: 400 });
  }

  const connection = getEvolutionSessions().find((s) => s.id === connectionId && s.clientId === clientId);
  if (!connection) {
    return NextResponse.json({ error: "Conexão Evolution inválida para esse cliente" }, { status: 400 });
  }

  // Resolve destinatários das duas fontes (CRM + lista manual), combináveis —
  // dedupe por telefone já normalizado no formato discável.
  const recipients = new Map<string, { phone: string; name?: string; leadId?: string }>();

  if (funnelId) {
    const leads = getLeads(clientId).filter((l) => l.funnelId === funnelId && (!columnId || l.status === columnId));
    for (const l of leads) {
      const rawPhone = l.realPhone ?? l.phone;
      if (!rawPhone) continue;
      const phone = toDialablePhone(rawPhone);
      if (!recipients.has(phone)) recipients.set(phone, { phone, name: l.name, leadId: l.id });
    }
  }

  let invalidManualCount = 0;
  if (Array.isArray(manualPhones)) {
    for (const raw of manualPhones) {
      const digits = String(raw ?? "").replace(/\D/g, "");
      if (digits.length < 10) { invalidManualCount++; continue; }
      const phone = toDialablePhone(String(raw));
      if (!recipients.has(phone)) recipients.set(phone, { phone });
    }
  }

  const list = [...recipients.values()];
  if (list.length === 0) {
    return NextResponse.json({ error: "Nenhum destinatário válido — selecione leads do CRM e/ou informe uma lista de números" }, { status: 400 });
  }

  const campaign = createBroadcast({
    clientId, name: name.trim(), message, connectionId, delaySeconds, totalCount: list.length,
  });
  createBroadcastItems(campaign.id, clientId, list, campaign.startedAt, delaySeconds);

  const alreadyRunning = getBroadcasts(clientId)
    .some((b) => b.id !== campaign.id && b.status === "running" && b.connectionId === connectionId);

  return NextResponse.json({
    campaign,
    recipientCount: list.length,
    invalidManualCount,
    warning: alreadyRunning ? "Já existe outra campanha em andamento nessa conexão — os disparos serão intercalados." : undefined,
  }, { status: 201 });
}
