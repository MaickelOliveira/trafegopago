import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnelForConnection } from "@/lib/lead-context";
import { getConfig } from "@/lib/clients";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getQrCode as getEvoQr, shouldRestartEvolutionSession, createOrRestartInstance } from "@/lib/evolution-api";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Funcionários precisam da permissão canManageQR
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? (await getEmployeeById(session.employeeId)) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) {
      return NextResponse.json({ error: "Sem permissão para gerar QR Code" }, { status: 403 });
    }
  }

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const { connectionId } = (await req.json()) as { connectionId: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId obrigatório" }, { status: 400 });

  if (!await getFunnelForConnection(clientId,connectionId)) return NextResponse.json({error:"Conexão não encontrada"},{status:404});
  // ── Evolution API ─────────────────────────────────────────────────────────
  const evoSessions = await getEvolutionSessions();
  const evoSession = evoSessions.find((s) => s.id === connectionId);
  if (evoSession) {
    const baseUrl = process.env.APP_BASE_URL || (await getConfig()).appBaseUrl;
    if (!baseUrl) return NextResponse.json({error:"Configure o endereço da plataforma."},{status:422});
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
