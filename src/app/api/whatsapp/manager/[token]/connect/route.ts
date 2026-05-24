import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectInstance, getQrCode, getPairingCode } from "@/lib/uazapi";
import QRCode from "qrcode";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  const body = await req.json() as { mode: "qr" | "code"; phone?: string };
  const { mode, phone } = body;

  if (mode === "code") {
    if (!phone) {
      return NextResponse.json({ error: "Telefone obrigatório para código de pareamento" }, { status: 400 });
    }
    const code = await getPairingCode(token, phone.replace(/\D/g, ""));
    if (!code) {
      return NextResponse.json({ error: "Não foi possível gerar o código. Certifique-se de que a instância existe e está desconectada." }, { status: 500 });
    }
    return NextResponse.json({ mode: "code", code });
  }

  // QR mode
  const connResult = await connectInstance(token);
  const connInst = (connResult.instance ?? connResult) as Record<string, unknown>;

  const rawQr: string | undefined =
    (connInst.qrcode as string) ||
    (connInst.qr as string) ||
    (connResult.qrcode as string) ||
    (connResult.qr as string) ||
    undefined;

  if (rawQr) {
    const qrImage = rawQr.startsWith("data:")
      ? rawQr
      : await QRCode.toDataURL(rawQr, { margin: 1, width: 300 }).catch(() => null);
    return NextResponse.json({ mode: "qr", status: "connecting", qr: qrImage });
  }

  // Fallback: try dedicated qrcode endpoint
  const dedicatedQr = await getQrCode(token);
  if (dedicatedQr) {
    const qrImage = dedicatedQr.startsWith("data:")
      ? dedicatedQr
      : await QRCode.toDataURL(dedicatedQr, { margin: 1, width: 300 }).catch(() => null);
    return NextResponse.json({ mode: "qr", status: "connecting", qr: qrImage });
  }

  return NextResponse.json({ mode: "qr", status: "connecting", qr: null });
}
