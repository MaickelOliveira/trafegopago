import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectInstance, getQrCode, getPairingCode, logoutInstance } from "@/lib/uazapi";
import QRCode from "qrcode";

async function extractQr(connResult: Record<string, unknown>): Promise<string | null> {
  const connInst = (connResult.instance ?? connResult) as Record<string, unknown>;
  const rawQr: string | undefined =
    (connInst.qrcode as string) ||
    (connInst.qr as string) ||
    (connInst.base64 as string) ||
    (connResult.qrcode as string) ||
    (connResult.qr as string) ||
    (connResult.base64 as string) ||
    undefined;

  if (rawQr) {
    return rawQr.startsWith("data:")
      ? rawQr
      : await QRCode.toDataURL(rawQr, { margin: 1, width: 300 }).catch(() => null);
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  const body = await req.json() as { mode: "qr" | "code"; phone?: string; force?: boolean };
  const { mode, phone, force } = body;

  if (mode === "code") {
    if (!phone) {
      return NextResponse.json({ error: "Telefone obrigatório para código de pareamento" }, { status: 400 });
    }
    // Desconecta primeiro se necessário (pairing code requer instância desconectada)
    if (force) {
      await logoutInstance(token).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    }
    const code = await getPairingCode(token, phone.replace(/\D/g, ""));
    if (!code) {
      return NextResponse.json({ error: "Não foi possível gerar o código. Tente forçar desconexão primeiro." }, { status: 500 });
    }
    return NextResponse.json({ mode: "code", code });
  }

  // QR mode
  // Se force=true, faz LOGOUT completo (apaga sessão) para forçar novo QR
  if (force) {
    await logoutInstance(token).catch(() => {});
    await new Promise(r => setTimeout(r, 3000)); // aguarda sessão ser limpa
  }

  const connResult = await connectInstance(token);
  let qrImage = await extractQr(connResult);

  if (qrImage) {
    return NextResponse.json({ mode: "qr", status: "connecting", qr: qrImage });
  }

  // Fallback: endpoint dedicado /instance/qrcode
  const dedicatedQr = await getQrCode(token);
  if (dedicatedQr) {
    qrImage = dedicatedQr.startsWith("data:")
      ? dedicatedQr
      : await QRCode.toDataURL(dedicatedQr, { margin: 1, width: 300 }).catch(() => null);
    return NextResponse.json({ mode: "qr", status: "connecting", qr: qrImage });
  }

  // Poll até QR aparecer (alguns servidores demoram ~2s para gerar)
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const retryQr = await getQrCode(token);
    if (retryQr) {
      qrImage = retryQr.startsWith("data:")
        ? retryQr
        : await QRCode.toDataURL(retryQr, { margin: 1, width: 300 }).catch(() => null);
      return NextResponse.json({ mode: "qr", status: "connecting", qr: qrImage });
    }
  }

  return NextResponse.json({ mode: "qr", status: "connecting", qr: null });
}
