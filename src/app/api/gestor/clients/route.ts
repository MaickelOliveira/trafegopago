import { assertAvailableLogin } from "@/lib/login-identity";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClients, upsertClient } from "@/lib/clients";
import { withDataTransaction } from "@/lib/document-store";
import { parseClientSettings, publicClientSettings } from "@/lib/client-settings";
import bcrypt from "bcryptjs";
export async function GET() {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  return NextResponse.json((await getClients()).map(publicClientSettings));
}
export async function POST(req: NextRequest) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  try {
    const { patch, password } = parseClientSettings(await req.json(), true);
    const passwordHash = await bcrypt.hash(password!, 12);
    const id = `${patch.name!.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "cliente"}-${randomUUID().slice(0, 8)}`;
    await withDataTransaction(async () => {
      await assertAvailableLogin(patch.email!);
      await upsertClient({ color: "#304a40", cplTarget: 25, funnelType: "leads", adAccounts: [], enabledSystems: [], ...patch, id, name: patch.name!, email: patch.email!, passwordHash });
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível criar o cliente." }, { status: 400 }); }
}
