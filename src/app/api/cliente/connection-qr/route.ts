import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { connectInstance, getQrCode as getUazapiQr } from "@/lib/uazapi";
import { getQrCode as getWppQr, shouldRestartWppSession, startSession } from "@/lib/wppconnect-api";
import { getQrCode as getEvoQr, shouldRestartEvolutionSession, createOrRestartInstance } from "@/lib/evolution-api";
import QRCode from "qrcode";

function detectBase(req: NextRequest): string {
  const fwdHost  = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return fwdHost ? `${fwdProto}://${fwdHost}` : `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

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
    // logout-session só tem efeito em sessão já autenticada — aqui a sessão está
    // sempre desconectada (é a única tela onde esse botão aparece), então é inútil
    // e só gera erro no servidor. O wppconnect.create() roda um ciclo interno de
    // ~60s (autoClose) — só reinicia depois que esse ciclo termina (compartilhado
    // com o painel do gestor, evita start-session duplicado na mesma sessão).
    const baseUrl = detectBase(req);
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/wppconnect/${wppSession.id}`;

    if (shouldRestartWppSession(wppSession.sessionName)) {
      await startSession(wppSession.sessionName, wppSession.sessionToken, webhookUrl).catch(() => {});
      let qr: string | null = null;
      for (let i = 0; i < 10; i++) {
        qr = await getWppQr(wppSession.sessionName, wppSession.sessionToken);
        if (qr) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      return NextResponse.json({ qr });
    }

    const qr = await getWppQr(wppSession.sessionName, wppSession.sessionToken);
    return NextResponse.json({ qr });
  }

  // ── Evolution API ─────────────────────────────────────────────────────────
  const evoSessions = getEvolutionSessions().filter(
    (s) => s.clientId === clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
  );
  const evoSession = evoSessions.find((s) => s.id === connectionId);
  if (evoSession) {
    const baseUrl = detectBase(req);
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/evolution/${evoSession.id}`;

    if (shouldRestartEvolutionSession(evoSession.instanceName)) {
      const result = await createOrRestartInstance(evoSession.instanceName, webhookUrl).catch(() => null);
      if (result?.qrBase64) return NextResponse.json({ qr: result.qrBase64 });
      let qr: string | null = null;
      for (let i = 0; i < 10; i++) {
        qr = await getEvoQr(evoSession.instanceName);
        if (qr) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      return NextResponse.json({ qr });
    }

    const qr = await getEvoQr(evoSession.instanceName);
    return NextResponse.json({ qr });
  }

  return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
}
