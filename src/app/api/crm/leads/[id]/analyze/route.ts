import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadById, updateLead } from "@/lib/leads";
import { getConfig } from "@/lib/clients";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const lead = getLeadById(id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = getConfig();
  if (!config.anthropicApiKey) {
    return NextResponse.json({ error: "API key não configurada" }, { status: 400 });
  }

  const ai = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `Analise este lead de tráfego pago e responda SOMENTE com JSON válido, sem markdown.

Dados do lead:
- Nome: ${lead.name}
- Telefone: ${lead.phone}
- Fonte: ${lead.source === "whatsapp" ? "WhatsApp direto" : lead.source === "form" ? "Formulário do site" : "Cadastro manual"}
- Campanha: ${lead.campaignName ?? "não informada"}
- Plataforma: ${lead.utmSource ?? "não informada"}
- Valor estimado: ${lead.value ? `R$ ${lead.value.toFixed(2)}` : "não informado"}
- Status atual: ${lead.status}
- Anotações: ${lead.notes || "nenhuma"}
- Criado há: ${Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000)} dias

Responda EXATAMENTE neste formato JSON:
{
  "summary": "resumo em 1-2 frases sobre o perfil e situação do lead",
  "score": 7,
  "nextStep": "próxima ação recomendada em 1 frase curta"
}

O score deve ser de 1 a 10 (intenção de compra). Seja direto e prático.`;

  try {
    const response = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON não encontrado na resposta");

    const parsed = JSON.parse(jsonMatch[0]);
    const aiData = {
      summary: String(parsed.summary ?? ""),
      score: Math.min(10, Math.max(1, Number(parsed.score) || 5)),
      nextStep: String(parsed.nextStep ?? ""),
      generatedAt: new Date().toISOString(),
    };

    const updated = updateLead(id, { ai: aiData });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[CRM AI] Erro:", err);
    return NextResponse.json({ error: "Erro na análise" }, { status: 500 });
  }
}
