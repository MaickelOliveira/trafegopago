import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDeviceById, updateDeviceFunnel } from "@/lib/extension-devices";
import { createFunnel, updateFunnel, getFunnelById } from "@/lib/funnels";
import { getClients, upsertClient, migrateAgentConfigByOldConnectionId } from "@/lib/clients";

/** Vincula o funil de CRM (e opcionalmente o Agente IA) de um dispositivo já
 *  conectado — só o gestor pode chamar, mesmo papel de
 *  /api/whatsapp/evolution-manager/link. A conexão técnica (gerar código,
 *  colar na extensão) é sempre feita pelo cliente — só existe o
 *  Chrome/WhatsApp Web dele —, mas o vínculo com CRM/IA é decisão do gestor,
 *  igual Evolution/UazAPI/WPPConnect/Meta.
 *
 *  Diferente de Evolution/UazAPI (onde vincular cliente+funil é a MESMA
 *  ação), o `clientId` de um dispositivo de extensão é fixo desde o
 *  pareamento — não dá pra "reatribuir" o dispositivo a outro cliente aqui,
 *  só escolher o funil/agente DENTRO do cliente que já é dono dele. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as {
    deviceId?: string;
    funnelId?: string | null;
    linkAgent?: boolean;
    reuseConnectionId?: string;
  } | null;
  if (!body?.deviceId) {
    return NextResponse.json({ error: "deviceId obrigatório" }, { status: 400 });
  }

  const device = getDeviceById(body.deviceId);
  if (!device) return NextResponse.json({ error: "Dispositivo não encontrado" }, { status: 404 });

  let funnelId = body.funnelId ?? null;
  if (funnelId?.startsWith("auto:")) {
    const autoClientId = funnelId.slice(5);
    const newFunnel = createFunnel("Funil Principal");
    updateFunnel(newFunnel.id, { clientId: autoClientId });
    funnelId = newFunnel.id;
  } else if (funnelId) {
    // Nunca confia no funnelId cru sem checar que é realmente um funil DO
    // MESMO cliente dono do dispositivo — senão o lead é gravado numa
    // combinação clientId/funnelId que nenhuma tela de CRM consegue exibir
    // (nem dá erro, o lead simplesmente some).
    const funnel = getFunnelById(funnelId);
    if (!funnel || funnel.clientId !== device.clientId) {
      return NextResponse.json({ error: "Funil inválido para este cliente" }, { status: 400 });
    }
  }

  const ok = updateDeviceFunnel(body.deviceId, funnelId);
  if (!ok) return NextResponse.json({ error: "Dispositivo não encontrado" }, { status: 404 });

  const linkAgent = body.linkAgent === true;
  let migratedConfig = false;
  const client = getClients().find((c) => c.id === device.clientId);
  if (client) {
    if (linkAgent && body.reuseConnectionId) {
      migratedConfig = migrateAgentConfigByOldConnectionId(device.clientId, body.reuseConnectionId, device.id);
    }
    const freshClient = getClients().find((c) => c.id === device.clientId) ?? client;
    upsertClient({
      ...freshClient,
      agentConfig: {
        ...(freshClient.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] }),
        whatsappConnectionId: linkAgent ? device.id : undefined,
      },
    });
  }

  return NextResponse.json({ ok: true, funnelId, migratedConfig });
}
