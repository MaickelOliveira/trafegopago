import { NextResponse } from "next/server";
import { getClients, getAllAgentConfigs } from "@/lib/clients";
import { extractAndWriteToSheet } from "@/lib/sheet-extractor";
import { getGeminiApiKey } from "@/lib/whatsapp-send";

// GET /api/admin/test-extrator?clientId=vitalli-garden
// Mostra a config e testa o extrator com uma mensagem fake
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId param required" }, { status: 400 });

  const client = getClients().find((c) => c.id === clientId);
  if (!client) return NextResponse.json({ error: "cliente não encontrado" }, { status: 404 });

  const configs = getAllAgentConfigs(client);
  const configSummary = configs.map((cfg) => ({
    connId: cfg.whatsappConnectionId,
    name: cfg.name,
    appsScriptUrl: cfg.appsScriptUrl ? cfg.appsScriptUrl.slice(0, 60) + "..." : null,
    hasRefreshToken: !!cfg.googleRefreshToken,
    spreadsheetId: cfg.spreadsheetId,
    mappingsCount: cfg.sheetMappings?.length ?? 0,
    mappings: cfg.sheetMappings?.map((m) => m.label),
  }));

  // Testa o Apps Script diretamente com payload de teste
  const testResults: Record<string, unknown>[] = [];
  for (const cfg of configs) {
    if (!cfg.appsScriptUrl) {
      testResults.push({ connId: cfg.whatsappConnectionId, result: "SKIP — sem appsScriptUrl" });
      continue;
    }

    const apiKey = getGeminiApiKey(cfg.geminiApiKey);
    if (!apiKey) {
      testResults.push({ connId: cfg.whatsappConnectionId, result: "SKIP — sem apiKey" });
      continue;
    }

    if (!cfg.googleRefreshToken || !cfg.spreadsheetId || !cfg.sheetMappings?.length) {
      testResults.push({ connId: cfg.whatsappConnectionId, result: "SKIP — sem refreshToken/spreadsheetId/mappings" });
      continue;
    }

    // Testa chamada direta ao Apps Script (sem extração de IA)
    try {
      const testPayload = {
        aba: cfg.sheetMappings[0].tabName,
        dados: { "Responsável": "TESTE EXTRATOR", "Telefone": "00000000000" },
        spreadsheetId: cfg.spreadsheetId,
      };
      const res = await fetch(cfg.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
      });
      const body = await res.text();
      testResults.push({
        connId: cfg.whatsappConnectionId,
        appsScriptStatus: res.status,
        appsScriptResponse: body.slice(0, 300),
        testPayload,
      });
    } catch (e) {
      testResults.push({
        connId: cfg.whatsappConnectionId,
        result: "ERRO fetch",
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Testa extrator completo com mensagem fake
    try {
      await extractAndWriteToSheet({
        apiKey,
        appsScriptUrl: cfg.appsScriptUrl,
        spreadsheetId: cfg.spreadsheetId,
        googleRefreshToken: cfg.googleRefreshToken,
        sheetMappings: cfg.sheetMappings,
        messages: [
          { role: "user", content: "Quero fazer um almoço dia 28 de junho, sou João Silva, 40 anos, de Campo Mourão, telefone 44999990000, somos 2 pessoas", ts: Date.now() },
          { role: "assistant", content: "Perfeito João! O valor total para 2 adultos é R$ 170,00. Dados do Pix: CNPJ 63.529.514/0001-59, Favorecido: Vitalli", ts: Date.now() },
        ],
        phone: "5544900000000",
      });
      testResults.push({ connId: cfg.whatsappConnectionId, extractorResult: "OK — verifique logs [sheet-extractor]" });
    } catch (e) {
      testResults.push({ connId: cfg.whatsappConnectionId, extractorError: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ clientId, configs: configSummary, testResults });
}
