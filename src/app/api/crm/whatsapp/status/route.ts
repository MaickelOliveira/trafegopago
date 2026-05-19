import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels } from "@/lib/funnels";
import { getInstanceStatus } from "@/lib/uazapi";
import QRCode from "qrcode";

const WA_SERVICE = "http://localhost:3002";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId");

  if (clientId) {
    const funnels = getFunnels();
    for (const funnel of funnels) {
      const conn = funnel.connections?.find((c) => c.id === clientId);
      if (conn?.type === "uazapi" && conn.uazapiToken) {
        const st = await getInstanceStatus(conn.uazapiToken);
        let qrImage: string | null = null;
        if (st.qr) {
          try { qrImage = await QRCode.toDataURL(st.qr, { margin: 1, width: 280 }); } catch { /**/ }
        }
        return NextResponse.json({
          connected: st.status === "connected",
          phone: st.phone ?? null,
          name: st.name ?? null,
          qr: qrImage,
          status: st.status,
        });
      }
    }

    // Baileys fallback
    try {
      const res = await fetch(`${WA_SERVICE}/status/${clientId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("WA service indisponível");
      const data = await res.json();
      let qrImage: string | null = null;
      if (data.qr) {
        try { qrImage = await QRCode.toDataURL(data.qr, { margin: 1, width: 280 }); } catch { /**/ }
      }
      return NextResponse.json({ connected: data.status === "connected", phone: data.phone, name: data.name, qr: qrImage, status: data.status });
    } catch {
      return NextResponse.json({ connected: false, qr: null, error: "wa-service offline" });
    }
  }

  // No clientId: try baileys global status
  try {
    const res = await fetch(`${WA_SERVICE}/status`, { cache: "no-store" });
    if (!res.ok) throw new Error("WA service indisponível");
    const data = await res.json();
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
