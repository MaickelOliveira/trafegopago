import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import QRCode from "qrcode";

const WA_SERVICE = "http://localhost:3002";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId");

  try {
    const url = clientId ? `${WA_SERVICE}/status/${clientId}` : `${WA_SERVICE}/status`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("WA service indisponível");
    const data = await res.json();

    // Resposta de uma instância específica
    if (clientId) {
      let qrImage: string | null = null;
      if (data.qr) {
        try { qrImage = await QRCode.toDataURL(data.qr, { margin: 1, width: 280 }); } catch { /**/ }
      }
      return NextResponse.json({ connected: data.status === "connected", phone: data.phone, name: data.name, qr: qrImage, status: data.status });
    }

    // Resposta com todas as instâncias — pega a primeira conectada para o header
    const entries = Object.entries(data as Record<string, { status: string; phone: string | null; name: string | null }>);
    const connected = entries.find(([, v]) => v.status === "connected");
    if (connected) {
      return NextResponse.json({ connected: true, phone: connected[1].phone, name: connected[1].name });
    }
    return NextResponse.json({ connected: false, qr: null });
  } catch {
    return NextResponse.json({ connected: false, qr: null, error: "wa-service offline" });
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await fetch(`${WA_SERVICE}/logout`, { method: "DELETE" });
  } catch { /**/ }
  return NextResponse.json({ ok: true });
}
