import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getLiveConnectionsForClient } from "@/lib/connection-metrics";
import QRCode from "qrcode";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const connections = await getLiveConnectionsForClient(clientId);

  // Renderiza o QR cru (texto) como imagem PNG base64 — só essa rota precisa disso (pareamento)
  const results = await Promise.all(
    connections.map(async ({ qr, ...conn }) => {
      if (!qr) return { ...conn, qr: null as string | null };
      try {
        const qrImage = qr.startsWith("data:") ? qr : await QRCode.toDataURL(qr, { margin: 1, width: 280 });
        return { ...conn, qr: qrImage };
      } catch {
        return { ...conn, qr: null as string | null };
      }
    })
  );

  return NextResponse.json({ connections: results });
}
