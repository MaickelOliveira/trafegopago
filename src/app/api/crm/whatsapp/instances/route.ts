import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { getFunnels, updateFunnel } from "@/lib/funnels";
import { listInstances, createInstance, connectInstance, logoutInstance, getInstanceStatus, getQrCode, setWebhook, updateFieldsMap } from "@/lib/uazapi";
import QRCode from "qrcode";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const instances = await listInstances();
    return NextResponse.json(instances);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { funnelId, instanceName } = body;

  if (!funnelId) return NextResponse.json({ error: "funnelId obrigatório" }, { status: 400 });
  if (!instanceName) return NextResponse.json({ error: "instanceName obrigatório" }, { status: 400 });

  const config = getConfig();
  const connId = instanceName;

  const funnels = getFunnels();
  const funnel = funnels.find((f) => f.id === funnelId);
  if (!funnel) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

  // Cria instância no UazapiGO
  const created = await createInstance(connId);
  const createdToken = (created.token as string) || (created.instanceToken as string) || (created.accessToken as string) || "";
  const instanceToken: string = createdToken || (process.env.UAZAPI_TOKEN || config.uazapiToken || "");

  // Conecta a instância (gera QR)
  const connResult = await connectInstance(instanceToken);

  const webhookUrl = `${config.appBaseUrl ?? ""}/api/whatsapp/webhook`;
  setWebhook(instanceToken, webhookUrl).catch(() => {});
  updateFieldsMap(instanceToken).catch(() => {});

  // Salva conexão no funil
  const alreadyExists = funnel.connections?.some(c => c.id === connId);
  if (!alreadyExists) {
    updateFunnel(funnelId, {
      connections: [...(funnel.connections ?? []), {
        id: connId,
        phone: "",
        type: "uazapi" as const,
        uazapiToken: instanceToken,
      }],
    });
  }

  const connInst = (connResult.instance ?? connResult) as Record<string, unknown>;
  const realInstanceToken = (connInst.token as string) || instanceToken;
  if (realInstanceToken !== instanceToken) {
    const f2 = getFunnels().find((f) => f.id === funnelId);
    if (f2) {
      updateFunnel(funnelId, {
        connections: (f2.connections ?? []).map((c) =>
          c.id === connId ? { ...c, uazapiToken: realInstanceToken } : c
        ),
      });
    }
    setWebhook(realInstanceToken, `${config.appBaseUrl ?? ""}/api/whatsapp/webhook`).catch(() => {});
    updateFieldsMap(realInstanceToken).catch(() => {});
  }

  const rawQr: string | undefined =
    (connInst.qrcode as string) ||
    (connInst.qr as string) ||
    (connResult.qrcode as string) ||
    (connResult.qr as string) ||
    undefined;

  if (rawQr) {
    const qrImage = rawQr.startsWith("data:")
      ? rawQr
      : await QRCode.toDataURL(rawQr, { margin: 1, width: 280 }).catch(() => null);
    return NextResponse.json({ status: "connecting", phone: null, qr: qrImage, connId });
  }

  const dedicatedQr = await getQrCode(instanceToken);
  if (dedicatedQr) {
    const qrImage = dedicatedQr.startsWith("data:")
      ? dedicatedQr
      : await QRCode.toDataURL(dedicatedQr, { margin: 1, width: 280 }).catch(() => null);
    return NextResponse.json({ status: "connecting", phone: null, qr: qrImage, connId });
  }

  let qrImage: string | null = null;
  let status = "connecting";
  let phone: string | null = null;

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await getInstanceStatus(instanceToken);
    status = st.status;
    phone = st.phone ?? null;
    if (st.qr) {
      qrImage = await QRCode.toDataURL(st.qr, { margin: 1, width: 280 }).catch(() => null);
      break;
    }
    if (st.status === "connected") break;
  }

  if (phone) {
    const f2 = getFunnels().find((f) => f.id === funnelId);
    if (f2) {
      updateFunnel(funnelId, {
        connections: (f2.connections ?? []).map((c) =>
          c.id === connId ? { ...c, phone: phone! } : c
        ),
      });
    }
  }

  return NextResponse.json({ status, phone, qr: qrImage, connId });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const funnels = getFunnels();
  for (const funnel of funnels) {
    const conn = funnel.connections?.find((c) => c.id === clientId);
    if (conn?.type === "uazapi" && conn.uazapiToken) {
      await logoutInstance(conn.uazapiToken).catch(() => {});
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}
