import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS_TO_TRY = [
  "gemini-2.5-pro-preview-05-06",
  "gemini-2.5-pro",
  "gemini-2.5-pro-exp-03-25",
  "gemini-1.5-pro",
];

// POST /api/agent/test?clientId=xxx[&connId=yyy] — testa conexão com Gemini e retorna diagnóstico
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  let agentGeminiKey: string | undefined;
  if (connId && client.agentConfigs) {
    const found = client.agentConfigs.find(c => c.whatsappConnectionId === connId);
    agentGeminiKey = found?.geminiApiKey;
  }
  if (!agentGeminiKey) agentGeminiKey = client.agentConfig?.geminiApiKey;

  const apiKey = getGeminiApiKey(agentGeminiKey);
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "Nenhuma chave Gemini configurada. Configure em Instruções do Agente → Chave Gemini API, ou em Configurações → APIs & Tokens → geminiApiKey.",
    });
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Tenta cada modelo até um funcionar
  for (const modelId of MODELS_TO_TRY) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent("Responda apenas: OK");
      const text = result.response.text();
      return NextResponse.json({ ok: true, model: modelId, response: text });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Se não for "model not found", para de tentar
      if (!msg.includes("not found") && !msg.includes("404") && !msg.includes("invalid")) {
        return NextResponse.json({ ok: false, model: modelId, error: msg });
      }
    }
  }

  return NextResponse.json({
    ok: false,
    error: "Nenhum modelo Gemini disponível para esta chave. Verifique se a chave está correta e tem acesso ao Gemini API.",
  });
}
