import { NextRequest, NextResponse } from "next/server";
import { getWppSessions, updateWppSession } from "@/lib/wppconnect-sessions";
import {
  checkConnectionStatus,
  sendText,
  isWppConnectConfigured,
  generateToken,
} from "@/lib/wppconnect-api";
import { getConfig } from "@/lib/clients";
import { readFileSync, existsSync } from "fs";
import path from "path";

function getAutomations(clientId: string) {
  try {
    const file = path.join(process.cwd(), "data", "crm-automations.json");
    if (!existsSync(file)) return [];
    const all = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>[];
    return all.filter((a) => a.clientId === clientId);
  } catch { return []; }
}

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
      const isBcrypt = s.sessionToken?.startsWith("$2b$") || s.sessionToken?.startsWith("$2a$");
      return {
        id: s.id,
        sessionName: s.sessionName,
        clientId: s.clientId,
        funnelId: s.funnelId,
        hasAgent: s.hasAgent,
        tokenPreview: s.sessionToken ? s.sessionToken.slice(0, 20) + "..." : "(vazio)",
        tokenType: isBcrypt ? "⚠️ BCRYPT HASH (inválido para WPPConnect)" : "OK (JWT?)",
        connectionStatus: statusResult,
      };
    })
  );

  // ?refresh=sessId → regera token JWT do WPPConnect e atualiza no arquivo
  const refreshId = req.nextUrl.searchParams.get("refresh");
  let refreshResult: unknown = null;
  if (refreshId) {
    const sess = sessions.find((s) => s.id === refreshId);
    if (!sess) {
      refreshResult = { error: "Sessão não encontrada" };
    } else {
      const newToken = await generateToken(sess.sessionName);
      if (newToken) {
        updateWppSession(sess.id, { sessionToken: newToken });
        refreshResult = { ok: true, sessId: sess.id, sessionName: sess.sessionName, newTokenPreview: newToken.slice(0, 30) + "..." };
      } else {
        refreshResult = { error: "generateToken retornou null — verifique WPPCONNECT_SECRET_KEY e URL" };
      }
    }
  }

  // ?phone=&sessId=&msg= → testa envio real
  const phone  = req.nextUrl.searchParams.get("phone");
  const msg    = req.nextUrl.searchParams.get("msg") ?? "Teste de automação CRM";
  const sessId = req.nextUrl.searchParams.get("sessId");
  let sendResult: unknown = null;
  if (phone && sessId) {
    const freshSessions = getWppSessions();  // lê de novo (pode ter sido atualizado pelo refresh)
    const sess = freshSessions.find((s) => s.id === sessId);
    if (!sess) {
      sendResult = { error: "Sessão não encontrada" };
    } else {
      sendResult = await sendText(sess.sessionName, sess.sessionToken, phone, msg)
        .then((ok) => ({ success: ok }))
        .catch((e: unknown) => ({ error: String(e) }));
    }
  }

  // ?clientId= → mostra automações salvas
  const clientId = req.nextUrl.searchParams.get("clientId");
  const automations = clientId ? getAutomations(clientId) : null;

  return NextResponse.json({
    configured,
    server: { env: serverEnv, config: serverCfg },
    secretKey: { env: keyEnv },
    sessions: sessionDetails,
    refreshResult,
    sendTest: sendResult,
    automations,
    hints: [
      "Regenerar token: ?refresh=UUID_DA_SESSAO",
      "Testar envio:    ?phone=5544XXXXXXX&sessId=UUID_DA_SESSAO&msg=Teste",
      "Ver automações:  ?clientId=sbcie",
    ],
  });
}
