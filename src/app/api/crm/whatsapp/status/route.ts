import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFunnels } from "@/lib/funnels";
import { getInstanceStatus } from "@/lib/uazapi";
import QRCode from "qrcode";

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
    return NextResponse.json({ connected: false, qr: null, status: "disconnected" });
  }

  return NextResponse.json({ connected: false, qr: null });
}

export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
