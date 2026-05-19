import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { getFunnels, updateFunnel } from "@/lib/funnels";
import { listInstances, createInstance, connectInstance, disconnectInstance, getInstanceStatus, getQrCode, setWebhook, updateFieldsMap } from "@/lib/uazapi";
import QRCode from "qrcode";
import { randomUUID } from "crypto";

const WA = "http://localhost:3002";

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
  const { type = "baileys", funnelId, instanceName, clientId: baileysClientId } = body;

  if (type === "uazapi") {
    if (!funnelId) return NextResponse.json({ error: "funnelId obrigatório" }, { status: 400 });

    const config = getConfig();
    const connId = instanceName ?? randomUUID();

    const funnels = getFunnels();
    const funnel = funnels.find((f) => f.id === funnelId);
    if (!funnel) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

    // Passo 1: tenta criar instância (multi-instance UazAPI)
    // Se falhar (single-instance ou sem permissão), usa o token global
    const created = await createInstance(connId);
    const createdToken = (created.token as string) || (created.instanceToken as string) || (created.accessToken as string) || "";
    const instanceToken: string = createdToken || (process.env.UAZAPI_TOKEN || config.uazapiToken || "");

    console.log("[UazAPI] instanceToken obtido:", instanceToken ? "sim" : "não", "| createInstance keys:", Object.keys(created).join(", "));

    // Passo 2: conecta a instância com o token disponível (gera QR)
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

    // Extrai QR da resposta do connectInstance (tenta vários campos)
    const rawQr: string | undefined =
      (connResult.qr as string) ??
      (connResult.qrcode as string) ??
      (connResult.qr_code as string) ??
      (connResult.base64 as string) ??
      undefined;

    if (rawQr) {
      const qrImage = rawQr.startsWith("data:")
        ? rawQr
        : await QRCode.toDataURL(rawQr, { margin: 1, width: 280 }).catch(() => null);
      return NextResponse.json({ status: "connecting", phone: null, qr: qrImage, connId });
    }

    // Se connectInstance não retornou QR, tenta endpoint dedicado /instance/qrcode
    const dedicatedQr = await getQrCode(instanceToken);
    if (dedicatedQr) {
      const qrImage = dedicatedQr.startsWith("data:")
        ? dedicatedQr
        : await QRCode.toDataURL(dedicatedQr, { margin: 1, width: 280 }).catch(() => null);
      return NextResponse.json({ status: "connecting", phone: null, qr: qrImage, connId });
    }

    // Última tentativa: poll do status
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

  // Baileys
  const clientId = baileysClientId;
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  await fetch(`${WA}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId: clientId, funnelId: funnelId ?? "default", clientId, type }),
  });

  let qrImage: string | null = null;
  let status = "connecting";
  let phone: string | null = null;
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const res = await fetch(`${WA}/status/${clientId}`, { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      status = data.status ?? "connecting";
      phone = data.phone ?? null;
      if (data.qr) {
        qrImage = await QRCode.toDataURL(data.qr, { margin: 1, width: 280 }).catch(() => null);
        break;
      }
      if (data.status === "connected") break;
    } catch { /**/ }
  }
  return NextResponse.json({ status, phone, qr: qrImage });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const funnels = getFunnels();
  for (const funnel of funnels) {
    const conn = funnel.connections?.find((c) => c.id === clientId);
    if (conn) {
      if (conn.type === "uazapi" && conn.uazapiToken) {
        await disconnectInstance(conn.uazapiToken);
      } else {
        await fetch(`${WA}/logout/${clientId}`, { method: "DELETE" }).catch(() => { });
      }
      return NextResponse.json({ ok: true });
    }
  }

  // Fallback: assume baileys if not found in funnels
  await fetch(`${WA}/logout/${clientId}`, { method: "DELETE" }).catch(() => { });
  return NextResponse.json({ ok: true });
}
