import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { getFunnels, updateFunnel } from "@/lib/funnels";
import { listInstances, connectInstance, disconnectInstance, getInstanceStatus, setWebhook, updateFieldsMap } from "@/lib/uazapi";
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

    // Tenta criar instância no UazAPI multi-instância; se falhar usa o token global (single-instance)
    const connResult = await connectInstance(connId);
    const instanceToken = connResult.instanceToken || config.uazapiToken || "";

    const webhookUrl = `${config.appBaseUrl ?? ""}/api/whatsapp/webhook`;
    setWebhook(instanceToken, webhookUrl).catch(() => {});
    updateFieldsMap(instanceToken).catch(() => {});

    const funnels = getFunnels();
    const funnel = funnels.find((f) => f.id === funnelId);
    if (!funnel) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

    // Verifica se já existe conexão UazAPI neste funil para não duplicar
    const alreadyExists = funnel.connections?.some(c => c.type === "uazapi");
    if (!alreadyExists) {
      const existing = funnel.connections ?? [];
      updateFunnel(funnelId, { connections: [...existing, {
        id: connId,
        phone: "",
        type: "uazapi" as const,
        uazapiToken: instanceToken,
      }]});
    }

    // Busca QR ou status de conexão
    let qrImage: string | null = null;
    let status = "connecting";
    let phone: string | null = null;

    // Verifica se o connectInstance já retornou QR diretamente
    const connectQr = connResult.qr ?? (connResult as Record<string, unknown>).qrCode ?? (connResult as Record<string, unknown>).qr_code;
    if (connectQr && typeof connectQr === "string") {
      const raw = connectQr.startsWith("data:") ? connectQr : null;
      qrImage = raw ?? await QRCode.toDataURL(connectQr, { margin: 1, width: 280 }).catch(() => null);
      status = "connecting";
      return NextResponse.json({ status, phone, qr: qrImage, connId });
    }

    // Primeiro tenta pegar QR imediatamente
    const immediateStatus = await getInstanceStatus(instanceToken);
    if (immediateStatus.qr) {
      qrImage = await QRCode.toDataURL(immediateStatus.qr, { margin: 1, width: 280 }).catch(() => null);
      status = immediateStatus.status;
    } else if (immediateStatus.status === "connected") {
      status = "connected";
      phone = immediateStatus.phone ?? null;
    } else {
      // Aguarda até 24s pelo QR
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
    }

    // Atualiza phone na conexão se já conectado
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
