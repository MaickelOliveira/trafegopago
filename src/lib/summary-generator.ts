import { GoogleGenerativeAI } from "@google/generative-ai";
import { getHistory } from "./conversations";
import type { AgentConfig } from "./clients";

function buildBasicSummary(history: import("./conversations").ChatMessage[]): string {
  if (history.length === 0) return "Sem histórico de conversa.";
  const last8 = history.slice(-8);
  const lines = last8.map((m) => {
    const role = m.role === "user" ? "Lead" : "Agente";
    const content = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
    return `*${role}:* ${content}`;
  });
  return `_Últimas mensagens da conversa:_\n\n${lines.join("\n\n")}`;
}

export async function generateSummaryText(
  clientName: string,
  agCfg: AgentConfig,
  phone: string,
  motivo: string,
  geminiApiKey?: string,
): Promise<string> {
  const history = getHistory(phone);
  if (history.length === 0) return "Sem histórico de conversa.";

  const recent = history.slice(-20);
  let transcript = recent
    .map((m) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
    .join("\n");
  if (transcript.length > 3000) transcript = transcript.slice(-3000);

  const apiKey = geminiApiKey || agCfg.geminiApiKey;

  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const prompt =
      `Você é um assistente que resume conversas de WhatsApp para o gestor.\n\n` +
      `Cliente/empresa: ${clientName}\n` +
      `Motivo do resumo: ${motivo}\n\n` +
      `Conversa:\n${transcript}\n\n` +
      `Faça um resumo objetivo em texto corrido (máximo 5 linhas) destacando: ` +
      `o que o lead quer, o estágio da conversa, dúvidas ou objeções levantadas, e próximo passo sugerido. ` +
      `Não use marcadores ou listas, escreva em parágrafos curtos.`;

    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
    for (const modelId of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text) {
          console.log(`[summary-generator] OK model=${modelId}`);
          return text;
        }
      } catch (err) {
        console.error(`[summary-generator] Falha model=${modelId}:`, err instanceof Error ? err.message : err);
      }
    }
    console.error("[summary-generator] Todos os modelos falharam — usando resumo básico");
  } else {
    console.error("[summary-generator] Chave Gemini não encontrada — usando resumo básico");
  }

  return buildBasicSummary(history);
}
