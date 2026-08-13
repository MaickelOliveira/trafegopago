import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateDeviceFunnel } from "@/lib/extension-devices";
import { createFunnel, updateFunnel } from "@/lib/funnels";

/** Vincula o funil de CRM de um dispositivo já conectado — só o gestor pode
 *  chamar, mesmo papel de /api/whatsapp/evolution-manager/link. A conexão
 *  técnica (gerar código, colar na extensão) é sempre feita pelo cliente —
 *  só existe o Chrome/WhatsApp Web dele —, mas o vínculo com o CRM é
 *  decisão do gestor, igual Evolution/UazAPI/WPPConnect/Meta. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { deviceId?: string; funnelId?: string | null } | null;
  if (!body?.deviceId) {
    return NextResponse.json({ error: "deviceId obrigatório" }, { status: 400 });
  }

  let funnelId = body.funnelId ?? null;
  if (funnelId?.startsWith("auto:")) {
    const autoClientId = funnelId.slice(5);
    const newFunnel = createFunnel("Funil Principal");
    updateFunnel(newFunnel.id, { clientId: autoClientId });
    funnelId = newFunnel.id;
  }

  const ok = updateDeviceFunnel(body.deviceId, funnelId);
  if (!ok) return NextResponse.json({ error: "Dispositivo não encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true, funnelId });
}
