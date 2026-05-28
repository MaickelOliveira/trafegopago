import { NextRequest, NextResponse } from "next/server";
import { getClients, getAllAgentConfigs, getConfig } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getHistory } from "@/lib/conversations";
import { generateFollowUpAI } from "@/lib/gemini-agent";
import { getGeminiApiKey } from "@/lib/whatsapp-send";

/**
 * GET /api/debug/test-followup?clientId=sbcie&phone=5544...&send=1
 *
 * Executa o fluxo completo de follow-up AI ao vivo e retorna cada passo.
 * Sem send=1 apenas testa a geração da IA sem enviar.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId = searchParams.get("clientId") ?? "sbcie";
  const phone = searchParams.get("phone") ?? "";
  const doSend = searchParams.get("send") === "1";

  const client = getClients().find((c) => c.id === clientId);
  if (!client) return NextResponse.json({ error: "cliente não encontrado" }, { status: 404 });

  const allCfgs = getAllAgentConfigs(client);
  const agCfg = allCfgs.find((c) => c.followUpEnabled);
  if (!agCfg) return NextResponse.json({ error: "nenhum agentConfig com followUpEnabled=true" }, { status: 400 });

  // Passo 1: API key
  const apiKey = getGeminiApiKey(agCfg.geminiApiKey);
  if (!apiKey) return NextResponse.json({ error: "geminiApiKey ausente", agCfg: { whatsappConnectionId: agCfg.whatsappConnectionId } }, { status: 400 });

  // Passo 2: Gera mensagem com IA
  const history = getHistory(phone);
  let aiMsg: string | null = null;
  let aiError: string | null = null;
  try {
    aiMsg = await generateFollowUpAI(history, undefined, client.name, apiKey);
  } catch (e) {
    aiError = e instanceof Error ? e.message : String(e);
  }

  if (!aiMsg) {
    return NextResponse.json({
      step: "generateFollowUpAI",
      success: false,
      aiMsg,
      aiError,
      historyLength: history.length,
    });
  }

  // Passo 3: Encontra conexão
  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const allConns = funnels.flatMap((f) => f.connections ?? []);
  const conn = allConns.find((c) => c.id === agCfg.whatsappConnectionId);

  if (!conn) {
    return NextResponse.json({
      step: "findConnection",
      success: false,
      lookedFor: agCfg.whatsappConnectionId,
      available: allConns.map((c) => c.id),
      aiMsg,
    });
  }

  if (conn.type !== "uazapi" || !conn.uazapiToken) {
    return NextResponse.json({
      step: "connectionCheck",
      success: false,
      connType: conn.type,
      hasToken: !!conn.uazapiToken,
      aiMsg,
    });
  }

  // Passo 4: Envia via UazAPI (apenas se send=1)
  if (!doSend) {
    return NextResponse.json({
      step: "ready_to_send",
      success: true,
      note: "Adicione &send=1 na URL para enviar de verdade",
      aiMsg,
      phone: phone.replace(/\D/g, ""),
      connectionId: conn.id,
      connType: conn.type,
    });
  }

  let sendOk = false;
  let sendError: string | null = null;
  const globalCfg = getConfig();
  const server = (globalCfg.uazapiServer ?? "https://nexopro.uazapi.com").replace(/\/$/, "");

  try {
    const res = await fetch(`${server}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: conn.uazapiToken },
      body: JSON.stringify({ number: phone.replace(/\D/g, ""), text: aiMsg }),
    });
    sendOk = res.ok;
    if (!res.ok) sendError = `HTTP ${res.status}: ${await res.text()}`;
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    step: "sendText",
    success: sendOk,
    sendError,
    aiMsg,
    phone: phone.replace(/\D/g, ""),
    connectionId: conn.id,
  });
}
