import { NextRequest, NextResponse } from "next/server";
import { getClients, getAllAgentConfigs, getConfig } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getHistory } from "@/lib/conversations";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * GET /api/debug/test-followup?clientId=sbcie&phone=5544...&send=1
 *
 * Testa o fluxo completo de follow-up AI e retorna erros reais do Gemini.
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
  if (!apiKey) return NextResponse.json({ step: "apiKey", error: "geminiApiKey ausente" }, { status: 400 });

  // Passo 2: Chama Gemini diretamente (sem try-catch interno que engole erro)
  const history = getHistory(phone);
  const historyText = history
    .slice(-20)
    .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
    .join("\n");

  const prompt = `Você é um assistente de vendas para ${client.name}.
Analise o histórico de conversa abaixo e crie uma mensagem de follow-up inteligente e personalizada em português.
Seja natural, breve (2-3 frases), retome o contexto de onde a conversa parou e demonstre interesse genuíno.
Retorne APENAS a mensagem, sem explicações adicionais.

Histórico:
${historyText || "Sem histórico de conversa disponível. Crie uma mensagem de reengajamento gentil."}`;

  let aiMsg: string | null = null;
  let aiError: string | null = null;
  let modelUsed: string | null = null;

  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];

  for (const modelId of modelsToTry) {
    try {
      const ai = new GoogleGenerativeAI(apiKey);
      const model = ai.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      if (text) {
        aiMsg = text;
        modelUsed = modelId;
        break;
      }
    } catch (e) {
      aiError = `${modelId}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (!aiMsg) {
    return NextResponse.json({
      step: "generateFollowUpAI",
      success: false,
      aiMsg: null,
      aiError,
      historyLength: history.length,
      apiKeyPrefix: apiKey.slice(0, 8) + "...",
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
      modelUsed,
    });
  }

  if (conn.type !== "uazapi" || !conn.uazapiToken) {
    return NextResponse.json({
      step: "connectionCheck",
      success: false,
      connType: conn.type,
      hasToken: !!conn.uazapiToken,
      aiMsg,
      modelUsed,
    });
  }

  // Passo 4: Envia via UazAPI (apenas se send=1)
  if (!doSend) {
    return NextResponse.json({
      step: "ready_to_send",
      success: true,
      note: "Adicione &send=1 na URL para enviar de verdade",
      aiMsg,
      modelUsed,
      phone: phone.replace(/\D/g, ""),
      connectionId: conn.id,
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
    modelUsed,
    phone: phone.replace(/\D/g, ""),
    connectionId: conn.id,
  });
}
