import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getInstanceStatus } from "@/lib/uazapi";
import QRCode from "qrcode";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await params;

  const st = await getInstanceStatus(token);

  let qrImage: string | null = null;
  if (st.qr) {
    try {
      qrImage = st.qr.startsWith("data:")
        ? st.qr
        : await QRCode.toDataURL(st.qr, { margin: 1, width: 280 });
    } catch { /**/ }
  }

  return NextResponse.json({
    status: st.status,
    connected: st.status === "connected",
    phone: st.phone ?? null,
    name: st.name ?? null,
    qr: qrImage,
  });
}
