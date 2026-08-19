import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBroadcastById, updateBroadcast } from "@/lib/broadcasts";
import { cancelBroadcastItems } from "@/lib/broadcast-items";

type Props = { params: Promise<{ id: string }> };

function canAccess(session: { role: string; clientId?: string | null }, clientId: string): boolean {
  return session.role === "manager" || !session.clientId || session.clientId === clientId;
}

// GET — devolve só a linha cacheada do pai (alvo do polling da tela de histórico)
export async function GET(_req: NextRequest, { params }: Props) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getBroadcastById(id);
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (!canAccess(session, campaign.clientId)) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  return NextResponse.json(campaign);
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = getBroadcastById(id);
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (!canAccess(session, campaign.clientId)) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { action } = await req.json() as { action?: "pause" | "resume" | "cancel" };

  // O claim em broadcast-items.ts já ignora campanhas que não estejam
  // "running" — pausar/retomar aqui só muda esse status, sem precisar tocar
  // nos itens da fila.
  if (action === "pause") {
    if (campaign.status !== "running") {
      return NextResponse.json({ error: "Só é possível pausar uma campanha em andamento" }, { status: 400 });
    }
    return NextResponse.json(updateBroadcast(id, { status: "paused" }));
  }

  if (action === "resume") {
    if (campaign.status !== "paused") {
      return NextResponse.json({ error: "Só é possível retomar uma campanha pausada" }, { status: 400 });
    }
    return NextResponse.json(updateBroadcast(id, { status: "running" }));
  }

  if (action === "cancel") {
    if (campaign.status === "completed" || campaign.status === "cancelled") {
      return NextResponse.json({ error: "Campanha já finalizada" }, { status: 400 });
    }
    cancelBroadcastItems(id);
    return NextResponse.json(updateBroadcast(id, { status: "cancelled" }));
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
