import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getGeminiApiKey } from "@/lib/whatsapp-send";

export const dynamic = "force-dynamic";

// Mesma lista de fallback usada de verdade em runGeminiAgent (gemini-agent.ts) —
// mantém em sincronia manualmente, é só pra diagnóstico.
const MODELS_TO_TRY = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];

function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.length <= 4 ? "****" : `****${key.slice(-4)}`;
}

/** Testa a MESMA chave/modelos que o agente de atendimento usaria de verdade
 *  pra essa conexão, com uma chamada mínima — devolve o erro exato de cada
 *  modelo em vez de só "problema técnico" genérico pro cliente. */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const connId = req.nextUrl.searchParams.get("connId") ?? undefined;
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });

  const agentCfg = getAgentConfigForConnection(client, connId);
  const apiKey = getGeminiApiKey(agentCfg?.geminiApiKey ?? undefined);

  if (!apiKey) {
    return NextResponse.json({
      clientId,
      connId: connId ?? null,
      agentEnabled: agentCfg?.enabled ?? null,
      error: "Nenhuma chave Gemini resolvida (nem do cliente, nem geral, nem env).",
    });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const results: { model: string; ok: boolean; error?: string }[] = [];

  for (const modelName of MODELS_TO_TRY) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const res = await model.generateContent("Responda só a palavra: ok");
      const text = res.response.text();
      results.push({ model: modelName, ok: true, error: text ? undefined : "resposta vazia" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ model: modelName, ok: false, error: msg });
    }
  }

  return NextResponse.json({
    clientId,
    connId: connId ?? null,
    agentEnabled: agentCfg?.enabled ?? null,
    apiKeyUsed: maskKey(apiKey),
    results,
  });
}
