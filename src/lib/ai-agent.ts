import Anthropic from "@anthropic-ai/sdk";
import { getClients, getConfig, type Client } from "./clients";
import { getAccountInsights, getCampaigns } from "./meta-api";
import type { ChatMessage } from "./conversations";

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildLeadSystemPrompt(): string {
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return `Você é o assistente virtual da TráfegoPago, uma agência especializada em tráfego pago.

Data atual: ${today}

Sobre a agência:
- Gerenciamos campanhas no Meta Ads (Facebook e Instagram) e Google Ads
- Atendemos negócios que querem gerar leads, vendas e tráfego qualificado
- Trabalhamos com análise de resultados, otimização e criação de anúncios

Como você deve agir:
- Seja amigável, direto e profissional
- Responda sempre em português, com mensagens curtas (máx. 3 parágrafos)
- Se perguntarem sobre preços, diga que depende do escopo e do objetivo e peça o e-mail para entrar em contato
- Se alguém quiser falar com o gestor, peça nome e e-mail e diga que retornaremos em breve
- Nunca invente dados, preços ou garantias de resultado
- Para dúvidas técnicas sobre Meta Ads ou Google Ads, explique de forma simples`;
}

async function buildClientSystemPrompt(client: Client): Promise<string> {
  const config = getConfig();
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const funnelLabel: Record<string, string> = {
    leads: "leads (conversas/formulários)",
    sales: "vendas (compras no site)",
    traffic: "tráfego (cliques e visitas)",
  };

  let campaignContext = "";

  if (client.adAccounts.length > 0) {
    const account = client.adAccounts[0];
    try {
      const [todayIns, yesterdayIns, weekIns, campaigns] = await Promise.all([
        getAccountInsights(account.id, config.metaToken, "today"),
        getAccountInsights(account.id, config.metaToken, "yesterday"),
        getAccountInsights(account.id, config.metaToken, "last_7d"),
        getCampaigns(account.id, config.metaToken, "today"),
      ]);

      const metricLine = (ins: typeof todayIns, label: string) => {
        if (!ins) return `${label}: sem dados`;
        const spend = `R$ ${fmt(ins.spend)}`;
        if (client.funnelType === "leads") {
          const cpl = ins.leads > 0 ? `CPL R$ ${fmt(ins.spend / ins.leads)}` : "sem leads";
          return `${label}: Gasto ${spend} | Leads ${ins.leads} | ${cpl}`;
        } else if (client.funnelType === "sales") {
          const roas = ins.spend > 0 && ins.revenue > 0 ? `ROAS ${(ins.revenue / ins.spend).toFixed(2)}x` : "sem vendas";
          return `${label}: Gasto ${spend} | Compras ${ins.purchases} | Receita R$ ${fmt(ins.revenue)} | ${roas}`;
        } else {
          return `${label}: Gasto ${spend} | Cliques ${ins.clicks} | CPC R$ ${fmt(ins.cpc)}`;
        }
      };

      const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").slice(0, 6);
      const campaignLines = activeCampaigns.map((c) => {
        const ins = c.insights;
        if (!ins || ins.spend === 0) return `  • ${c.name}: sem gasto hoje`;
        if (client.funnelType === "leads") {
          return `  • ${c.name}: R$ ${fmt(ins.spend)} | ${ins.leads} leads`;
        } else if (client.funnelType === "sales") {
          return `  • ${c.name}: R$ ${fmt(ins.spend)} | ${ins.purchases} compras | R$ ${fmt(ins.revenue)} receita`;
        } else {
          return `  • ${c.name}: R$ ${fmt(ins.spend)} | ${ins.clicks} cliques`;
        }
      });

      campaignContext = `
Performance da conta "${account.name}":
${metricLine(todayIns, "Hoje")}
${metricLine(yesterdayIns, "Ontem")}
${metricLine(weekIns, "Últimos 7 dias")}

Campanhas ativas hoje:
${campaignLines.length > 0 ? campaignLines.join("\n") : "  Nenhuma campanha com gasto hoje"}`;
    } catch (e) {
      console.error("[ai-agent] Erro ao buscar dados Meta:", e);
      campaignContext = "\nDados de campanha temporariamente indisponíveis.";
    }
  } else {
    campaignContext = "\nNenhuma conta de anúncio conectada.";
  }

  // Se o cliente configurou um prompt personalizado, usa ele como base
  if (client.agentPrompt?.trim()) {
    return `${client.agentPrompt.trim()}

--- Dados de campanha em tempo real (use se perguntarem sobre resultados) ---
${campaignContext}

Data atual: ${today}
Responda sempre em português, mensagens curtas. Nunca invente dados.`;
  }

  return `Você é o assistente de resultados de tráfego pago para ${client.name}.
Data: ${today}
Objetivo de negócio: ${funnelLabel[client.funnelType] ?? "leads"}
CPL alvo: R$ ${client.cplTarget}
${campaignContext}

Como você deve agir:
- Responda perguntas sobre campanhas usando os dados acima
- Para períodos não listados (ex: mês passado, últimos 30 dias), diga que esses dados estão disponíveis no portal e oriente o cliente a acessar
- Para perguntas técnicas (como aumentar budget, pausar campanha), diga que vai comunicar ao gestor
- Seja objetivo e use linguagem simples, sem jargão técnico excessivo
- Responda sempre em português, mensagens curtas
- Se não souber algo, seja honesto — não invente dados`;
}

export async function generateResponse(
  userMessage: string,
  history: ChatMessage[],
  clientId: string | null
): Promise<string> {
  const config = getConfig();
  const apiKey = config.anthropicApiKey;

  if (!apiKey) {
    return "Serviço de IA não configurado. Entre em contato com o gestor.";
  }

  const ai = new Anthropic({ apiKey });

  let systemPrompt: string;
  if (clientId) {
    const clients = getClients();
    const client = clients.find((c) => c.id === clientId);
    systemPrompt = client
      ? await buildClientSystemPrompt(client)
      : buildLeadSystemPrompt();
  } else {
    systemPrompt = buildLeadSystemPrompt();
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  try {
    const response = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: systemPrompt,
      messages,
    });

    const block = response.content[0];
    return block.type === "text" ? block.text : "";
  } catch (err) {
    console.error("[ai-agent] Erro na API Anthropic:", err);
    return "Estou com uma instabilidade no momento. Tente novamente em alguns segundos.";
  }
}
