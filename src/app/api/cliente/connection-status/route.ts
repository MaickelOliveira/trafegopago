import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getInstanceStatus } from "@/lib/uazapi";
import { checkConnectionStatus } from "@/lib/wppconnect-api";
import QRCode from "qrcode";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const results: {
    id: string;
    phone: string;
    type: string;
    status: string;
    connected: boolean;
    qr?: string | null;
  }[] = [];

  // ── UazAPI connections ──────────────────────────────────────────────────────
  const seen = new Set<string>();
  for (const funnel of funnels) {
    for (const conn of funnel.connections ?? []) {
      if (conn.type !== "uazapi" || !conn.uazapiToken || seen.has(conn.id)) continue;
      seen.add(conn.id);
      try {
        const st = await getInstanceStatus(conn.uazapiToken);
        let qrImage: string | null = null;
        if (st.qr) {
          try {
            qrImage = st.qr.startsWith("data:") ? st.qr : await QRCode.toDataURL(st.qr, { margin: 1, width: 280 });
          } catch { /**/ }
        }
        results.push({
          id: conn.id,
          phone: st.phone ?? conn.phone ?? conn.id,
          type: "uazapi",
          status: st.status,
          connected: st.status === "connected",
          qr: qrImage,
        });
      } catch {
        results.push({ id: conn.id, phone: conn.phone, type: "uazapi", status: "error", connected: false });
      }
    }
  }

  // ── WPPConnect sessions ─────────────────────────────────────────────────────
  const clientFunnelIds = new Set(funnels.map((f) => f.id));
  const wppSessions = getWppSessions().filter(
    (s) => s.clientId === clientId || (s.funnelId && clientFunnelIds.has(s.funnelId))
  );
  for (const s of wppSessions) {
    try {
      const status = await checkConnectionStatus(s.sessionName, s.sessionToken);
      results.push({
        id: s.id,
        phone: s.sessionName,
        type: "wppconnect",
        status,
        connected: status === "CONNECTED",
      });
    } catch {
      results.push({ id: s.id, phone: s.sessionName, type: "wppconnect", status: "error", connected: false });
    }
  }

  return NextResponse.json({ connections: results });
}
