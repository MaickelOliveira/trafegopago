import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, saveConfig } from "@/lib/clients";
import { withDataTransaction } from "@/lib/document-store";
import { safePlatformConfig, platformConfigPatch } from "@/lib/platform-settings";
export async function GET() {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  return NextResponse.json(safePlatformConfig(await getConfig()));
}
export async function PUT(req: NextRequest) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  try {
    const patch = platformConfigPatch(await req.json());
    await withDataTransaction(async () => { await saveConfig({ ...await getConfig(), ...patch }); });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Confira os valores e endereços informados." }, { status: 400 }); }
}
