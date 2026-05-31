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

  // ?phone=&sessId=&msg= → testa envio real (com resposta completa do WPPConnect)
  const phone  = req.nextUrl.searchParams.get("phone");
  const msg    = req.nextUrl.searchParams.get("msg") ?? "Teste de automação CRM";
  const sessId = req.nextUrl.searchParams.get("sessId");
  let sendResult: unknown = null;
  if (phone && sessId) {
    const freshSessions = getWppSessions();
    const sess = freshSessions.find((s) => s.id === sessId);
    if (!sess) {
      sendResult = { error: "Sessão não encontrada" };
    } else {
      try {
        const wppBase = (process.env.WPPCONNECT_SERVER || "").replace(/\/$/, "");
        // Normaliza telefone brasileiro (mesma lógica do wppconnect-api)
        let d = phone.replace(/@.*$/, "").replace(/\D/g, "");
        if (d.startsWith("55")) {
          if (d.length === 12) d = d.slice(0, 4) + "9" + d.slice(4);
        } else {
          if (d.length === 10) d = "55" + d.slice(0, 2) + "9" + d.slice(2);
          if (d.length === 11) d = "55" + d;
        }
        const phoneFormatted = `${d}@c.us`;
        const res = await fetch(`${wppBase}/api/${sess.sessionName}/send-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${sess.sessionToken}`,
          },
          body: JSON.stringify({ phone: phoneFormatted, message: msg, isGroup: false }),
        });
        const body = await res.text().catch(() => "(sem corpo)");
        sendResult = {
          httpStatus: res.status,
          ok: res.ok,
          responseBody: body,
          requestUrl: `${wppBase}/api/${sess.sessionName}/send-message`,
          phoneFormatted,
          tokenPreview: sess.sessionToken.slice(0, 30) + "...",
        };
      } catch (e: unknown) {
        sendResult = { error: String(e) };
      }
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
