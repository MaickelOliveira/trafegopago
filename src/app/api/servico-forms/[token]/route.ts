import { NextRequest, NextResponse } from "next/server";
import { getServicoFormByToken, submitServicoForm, type ServicoFormPessoa } from "@/lib/servico-forms";
import { getClientById, getConfig, getAgentConfigForConnection, type Client } from "@/lib/clients";
import { getGeminiApiKey } from "@/lib/whatsapp-send";
import { addMessage, getHistory, type ChatMessage } from "@/lib/conversations";
import { extractAndWriteToPousada, alertManagerFormNotProcessed } from "@/lib/pousada-extractor";
import { processKanbanActions } from "@/lib/kanban-agent";
import type { Pessoa } from "@/lib/pousada-types";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

// GET /api/servico-forms/[token] — público, sem autenticação (o token já é o segredo).
// Carrega os dados pra renderizar a página do formulário.
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  const form = getServicoFormByToken(token);
  if (!form) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  return NextResponse.json({
    clientName: form.clientName ?? null,
    tipoLabel: form.tipoLabel ?? null,
    status: form.status,
    pessoas: form.pessoas ?? null,
  });
}

// POST /api/servico-forms/[token] — público, o cliente envia os dados de cada participante.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  const form = getServicoFormByToken(token);
  if (!form) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  const { pessoas } = await req.json() as { pessoas?: ServicoFormPessoa[] };
  const isComplete = (p: ServicoFormPessoa) =>
    !!p.nome?.trim() && !!p.telefone?.trim() && typeof p.idade === "number" && !isNaN(p.idade);
  if (!Array.isArray(pessoas) || pessoas.length === 0 || pessoas.some((p) => !isComplete(p))) {
    return NextResponse.json({ error: "Preencha nome, telefone e idade de cada participante" }, { status: 400 });
  }

  const updated = submitServicoForm(token, pessoas);
  if (!updated) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  const resumoTexto = formatPessoasParaConversa(pessoas);

  // Grava a mensagem do cliente (dados do formulário) no histórico ANTES de
  // extrair — a extração lê o histórico completo pra montar a reserva.
  const historyAntes = getHistory(form.phone, form.clientId, form.connId ?? undefined);
  addMessage(form.phone, { role: "user", content: resumoTexto, ts: Date.now() }, form.clientId, { connId: form.connId ?? undefined });
  const historyDepois = getHistory(form.phone, form.clientId, form.connId ?? undefined);

  // Movimenta o Kanban normalmente (mesmo efeito que uma mensagem real do
  // WhatsApp teria) — não bloqueia o restante do fluxo.
  processKanbanActions(resumoTexto, historyAntes, form.clientId, form.phone, form.connId ?? undefined).catch(() => {});

  // ── Extração determinística da reserva (preferida) ───────────────────────
  // Diferente do formulário de hóspedes de Hospedagem (que também cobra o Pix
  // deterministicamente), aqui não há preço fixo pra calcular — mas a reserva
  // em si PRECISA ser escrita sem depender da IA conversacional notar a
  // mensagem reinjetada e agir sozinha: isso já falhou na prática (dois
  // preenchimentos que não geraram reserva nenhuma, sem nenhum registro).
  // Com o tipo do serviço já conhecido (escolhido ao gerar o link, ou o único
  // tipo "evento" configurado), a extração fica determinística — não depende
  // da IA adivinhar qual serviço bate com o assunto da conversa.
  try {
    await tryCreateReserva(form.clientId, form, historyDepois, pessoas);
  } catch (e) {
    console.error("[servico-forms] erro ao extrair reserva:", e instanceof Error ? e.message : e);
  }

  // ── Fluxo conversacional — retoma a conversa pra IA responder naturalmente
  // ao cliente (valor, Pix, próximos passos), como se fosse uma mensagem
  // normal chegando pelo WhatsApp.
  const appBaseUrl = getConfig().appBaseUrl?.replace(/\/$/, "");
  if (appBaseUrl && form.connId) {
    const { url, body } = buildResumePayload(appBaseUrl, form.connId, form.connType, form.phone, resumoTexto);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) => console.error("[servico-forms] erro ao retomar conversa:", e));
  } else {
    console.warn(`[servico-forms] Não foi possível retomar a conversa — appBaseUrl=${!!getConfig().appBaseUrl} connId=${form.connId}`);
  }

  return NextResponse.json({ ok: true });
}

async function tryCreateReserva(
  clientId: string,
  form: { connId?: string | null; tipoSlug?: string; phone: string },
  messages: ChatMessage[],
  pessoasFormulario: ServicoFormPessoa[],
): Promise<void> {
  const client: Client | undefined = getClientById(clientId);
  if (!client?.enabledSystems?.includes("pousada") || !client.pousadaTipos?.length) {
    console.log(`[servico-forms] tryCreateReserva: pousada não habilitada/sem tipos — clientId=${clientId}`);
    return;
  }

  const agentCfg = getAgentConfigForConnection(client, form.connId ?? undefined);
  const apiKey = getGeminiApiKey(agentCfg?.geminiApiKey ?? undefined);
  if (!apiKey) {
    console.log(`[servico-forms] tryCreateReserva: sem apiKey Gemini — clientId=${clientId} connId=${form.connId}`);
    return;
  }

  // Com tipo escolhido ao gerar o link, restringe a extração a esse único
  // tipo — elimina qualquer ambiguidade. Sem tipo (ex: link gerado pela IA
  // via marcador, hoje sem seleção de serviço), cai pra todos os tipos
  // "evento" configurados, mesma lista que o restante do sistema já usa.
  const tiposParaExtracao = form.tipoSlug
    ? client.pousadaTipos.filter((t) => t.slug === form.tipoSlug)
    : client.pousadaTipos.filter((t) => (t.categoria ?? "evento") !== "hospedagem");
  if (!tiposParaExtracao.length) {
    console.log(`[servico-forms] tryCreateReserva: nenhum tipo elegível — clientId=${clientId} tipoSlug=${form.tipoSlug}`);
    return;
  }

  // Dados já validados do formulário (nome/telefone/idade obrigatórios) —
  // vira o fallback determinístico dentro de extractAndWriteToPousada quando
  // a IA não conseguir extrair nada da conversa. valor:0 porque o formulário
  // não coleta preço (varia por faixa etária/serviço, só a IA calcula isso a
  // partir da conversa); no fallback fica "a confirmar".
  const knownPessoas: Pessoa[] = pessoasFormulario.map((p) => ({
    nome: p.nome,
    idade: p.idade,
    telefone: p.telefone,
    valor: 0,
  }));

  let affectedCount = 0;
  try {
    const affected = await extractAndWriteToPousada({
      apiKey,
      clientId,
      tipos: tiposParaExtracao,
      totalQuartos: client.pousadaTotalQuartos ?? 0,
      messages,
      phone: form.phone,
      motivo: "DADOS RECEBIDOS: formulário de serviços preenchido",
      knownPessoas,
    });
    affectedCount = affected.length;
    console.log(`[servico-forms] tryCreateReserva OK — clientId=${clientId} reservasAfetadas=${affectedCount}`);
  } catch (e) {
    console.error("[servico-forms] erro ao extrair reserva:", e instanceof Error ? e.message : e);
  }

  if (affectedCount === 0) {
    // Mesma rede de segurança do formulário de hóspedes: extração falhou ou
    // rodou sem achar/gerar nenhuma reserva reconhecível — avisa o gestor em
    // vez de deixar isso passar em silêncio.
    console.warn(`[servico-forms] tryCreateReserva não gerou nenhuma reserva — alertando gestor — clientId=${clientId}`);
    await alertManagerFormNotProcessed(client, form.connId, form.phone).catch((e) =>
      console.error("[servico-forms] erro ao alertar gestor sobre falha na extração:", e)
    );
  }
}

function buildResumePayload(
  appBaseUrl: string,
  connId: string,
  connType: string | null | undefined,
  phone: string,
  message: string,
): { url: string; body: unknown } {
  if (connType === "evolution") {
    return {
      url: `${appBaseUrl}/api/whatsapp/webhook/evolution/${connId}`,
      body: {
        event: "messages_upsert",
        data: {
          key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `servico-form-${Date.now()}` },
          message: { conversation: message },
          messageType: "conversation",
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
    };
  }
  // uazapi/[instanceId] (padrão) — aceita o formato legado simples {phone, message}.
  return {
    url: `${appBaseUrl}/api/whatsapp/webhook/${connId}`,
    body: { phone, message },
  };
}

function formatPessoasParaConversa(pessoas: ServicoFormPessoa[]): string {
  const blocos = pessoas.map((p, i) =>
    [
      `${i + 1}. Nome completo: ${p.nome}`,
      `Telefone: ${p.telefone}`,
      `Idade: ${p.idade}`,
    ].join("\n")
  );
  return `Preenchi o formulário de participantes com os seguintes dados:\n\n${blocos.join("\n\n")}`;
}
