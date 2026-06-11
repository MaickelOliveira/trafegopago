import { NextResponse } from "next/server";
import { getClients } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";

export const dynamic = "force-dynamic";

/** Lista, sem expor segredos, todos os clientes, funis e conexões — útil para descobrir IDs. */
export async function GET() {
  const clients = getClients().map((c) => ({ id: c.id, name: c.name }));

  const funnels = getFunnels().map((f) => ({
    id: f.id,
    name: f.name,
    clientId: f.clientId ?? null,
    connections: (f.connections ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      phone: c.phone,
      hasMetaToken: !!c.metaToken,
      metaPhoneNumberId: c.metaPhoneNumberId ?? null,
      hasUazapiToken: !!c.uazapiToken,
    })),
  }));

  const wppSessions = getWppSessions().map((s) => ({
    id: s.id,
    sessionName: s.sessionName,
    funnelId: s.funnelId ?? null,
    clientId: s.clientId ?? null,
  }));

  return NextResponse.json({ clients, funnels, wppSessions });
}
