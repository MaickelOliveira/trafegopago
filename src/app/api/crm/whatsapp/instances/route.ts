import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import QRCode from "qrcode";

const WA = "http://localhost:3002";

// GET — lista todas instâncias com status
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const res = await fetch(`${WA}/status`, { cache: "no-store" });
    const data = res.ok ? await res.json() : {};
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({});
  }
}

// POST — conecta uma instância { clientId }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  await fetch(`${WA}/connect/${clientId}`, { method: "POST" });
  // Aguarda QR
  await new Promise(r => setTimeout(r, 4000));
  const res = await fetch(`${WA}/status/${clientId}`, { cache: "no-store" });
  const data = res.ok ? await res.json() : {};
  let qrImage: string | null = null;
  if (data.qr) {
    try { qrImage = await QRCode.toDataURL(data.qr, { margin: 1, width: 280 }); } catch { /**/ }
  }
  return NextResponse.json({ status: data.status, phone: data.phone, qr: qrImage });
}

// DELETE — desconecta { clientId }
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId } = await req.json();
  await fetch(`${WA}/logout/${clientId}`, { method: "DELETE" });
  return NextResponse.json({ ok: true });
}
