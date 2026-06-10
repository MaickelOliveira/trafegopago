import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels, updateFunnel } from "@/lib/funnels";

// POST /api/admin/fix-funnel-client
// Body: { funnelId, clientId }
// Corrige o clientId de um funil corrompido
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { funnelId, clientId } = await req.json() as { funnelId: string; clientId: string };
  if (!funnelId || !clientId) {
    return NextResponse.json({ error: "funnelId e clientId obrigatórios" }, { status: 400 });
  }

  const funnels = getFunnels();
  const funnel = funnels.find(f => f.id === funnelId);
  if (!funnel) {
    return NextResponse.json({ error: `Funil ${funnelId} não encontrado` }, { status: 404 });
  }

  const old = funnel.clientId;
  updateFunnel(funnelId, { clientId });

  return NextResponse.json({ ok: true, funnelId, oldClientId: old, newClientId: clientId, funnelName: funnel.name });
}
