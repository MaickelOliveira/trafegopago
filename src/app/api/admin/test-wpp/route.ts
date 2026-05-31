import { NextRequest, NextResponse } from "next/server";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { checkConnectionStatus, sendText, isWppConnectConfigured } from "@/lib/wppconnect-api";
import { getConfig } from "@/lib/clients";

export async function GET(req: NextRequest) {
  const cfg = getConfig();
  const serverEnv   = process.env.WPPCONNECT_SERVER ?? "(não definido)";
  const serverCfg   = cfg.wppconnectServer ?? "(não definido)";
  const keyEnv      = process.env.WPPCONNECT_SECRET_KEY ? "****" : "(não definido)";
  const configured  = isWppConnectConfigured();

  const sessions = getWppSessions();
  const sessionDetails = await Promise.all(
    sessions.map(async (s) => {
      const statusResult = configured
        ? await checkConnectionStatus(s.sessionName, s.sessionToken).catch((e: unknown) => `ERRO: ${e}`)
        : "N/A (WPPConnect não configurado)";
      return {
        id: s.id,
        sessionName: s.sessionName,
        clientId: s.clientId,
        funnelId: s.funnelId,
        hasAgent: s.hasAgent,
        tokenPreview: s.sessionToken ? s.sessionToken.slice(0, 20) + "..." : "(vazio)",
        connectionStatus: statusResult,
      };
    })
  );

  // Test send (optional — pass ?phone=5544...&msg=Teste na URL)
  const phone = req.nextUrl.searchParams.get("phone");
  const msg   = req.nextUrl.searchParams.get("msg") ?? "Teste de automação CRM";
  const sessId = req.nextUrl.searchParams.get("sessId");
  let sendResult: unknown = null;

  if (phone && sessId) {
    const sess = sessions.find((s) => s.id === sessId);
    if (!sess) {
      sendResult = { error: "Sessão não encontrada" };
    } else {
      sendResult = await sendText(sess.sessionName, sess.sessionToken, phone, msg)
        .then((ok) => ({ success: ok }))
        .catch((e: unknown) => ({ error: String(e) }));
    }
  }

  return NextResponse.json({
    configured,
    server: { env: serverEnv, config: serverCfg },
    secretKey: { env: keyEnv },
    sessions: sessionDetails,
    sendTest: sendResult,
    hint: sendResult === null
      ? "Para testar envio: ?phone=5544XXXXXXX&sessId=UUID_DA_SESSAO&msg=Teste"
      : undefined,
  });
}
