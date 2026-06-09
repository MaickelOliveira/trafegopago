import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { connectInstance, getQrCode as getUazapiQr } from "@/lib/uazapi";
import { getQrCode as getWppQr } from "@/lib/wppconnect-api";
import QRCode from "qrcode";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Funcionários precisam da permissão canManageQR
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) {
      return NextResponse.json({ error: "Sem permissão para gerar QR Code" }, { status: 403 });
    }
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const { connectionId } = (await req.json()) as { connectionId: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId obrigatório" }, { status: 400 });

  // ── UazAPI ──────────────────────────────────────────────────────────────────
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  for (const funnel of funnels) {
    const conn = (funnel.connections ?? []).find((c) => c.id === connectionId && c.type === "uazapi");
    if (conn?.uazapiToken) {
      await connectInstance(conn.uazapiToken).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const rawQr = await getUazapiQr(conn.uazapiToken);
      if (rawQr) {
        const qrImage = rawQr.startsWith("data:")
          ? rawQr
          : await QRCode.toDataURL(rawQr, { margin: 1, width: 280 }).catch(() => null);
        return NextResponse.json({ qr: qrImage });
      }
      return NextResponse.json({ qr: null, message: "Aguardando QR..." });
    }
  }

  // ── WPPConnect ──────────────────────────────────────────────────────────────
  const clientFunnelIds = new Set(funnels.map((f) => f.id));
  const wppSessions = getWppSessions().filter(
    (s) => s.clientId === clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
  );
  const wppSession = wppSessions.find((s) => s.id === connectionId);
  if (wppSession) {
    const qr = await getWppQr(wppSession.sessionName, wppSession.sessionToken);
    return NextResponse.json({ qr });
  }

  return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
}
