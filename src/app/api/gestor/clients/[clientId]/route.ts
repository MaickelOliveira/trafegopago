import { assertAvailableLogin } from "@/lib/login-identity";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getClients, patchClient, deleteClient } from "@/lib/clients";
import { withDataTransaction } from "@/lib/document-store";
import { parseClientSettings, publicClientSettings } from "@/lib/client-settings";
import bcrypt from "bcryptjs";
type Params = { params: Promise<{ clientId: string }> };
export async function GET(_req: NextRequest, { params }: Params) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const client = await getClientById((await params).clientId);
  return client ? NextResponse.json(publicClientSettings(client)) : NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
}
export async function PUT(req: NextRequest, { params }: Params) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const { clientId } = await params;
  if (!await getClientById(clientId)) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
  try {
    const { patch, password } = parseClientSettings(await req.json());
    if (patch.trackingFunnelId) {
      const { getFunnelById } = await import("@/lib/funnels");
      if ((await getFunnelById(patch.trackingFunnelId))?.clientId !== clientId) throw Error("Escolha um funil deste cliente.");
    }
    if (password) patch.passwordHash = await bcrypt.hash(password, 12);
    await withDataTransaction(async () => {
      if (patch.email) await assertAvailableLogin(patch.email, clientId);
      const current = await getClientById(clientId);
      if (patch.enabledSystems && current) {
        const { AVAILABLE_SYSTEMS } = await import("@/lib/systems");
        patch.enabledSystems = [...new Set([...(current.enabledSystems ?? []).filter(slug => !AVAILABLE_SYSTEMS.some(system => system.slug === slug)), ...patch.enabledSystems])];
      }
      await patchClient(clientId, patch);
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar." }, { status: 400 }); }
}
export async function DELETE(_req: NextRequest, { params }: Params) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  await deleteClient((await params).clientId);
  return NextResponse.json({ ok: true });
}
