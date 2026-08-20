import { NextRequest, NextResponse } from "next/server";
import { getGuestFormByToken, submitGuestForm, type GuestFormPessoa } from "@/lib/guest-forms";
import { getClientById, getConfig, getAgentConfigForConnection } from "@/lib/clients";
import { getGeminiApiKey, sendMessage } from "@/lib/whatsapp-send";
import { addMessage, getHistory } from "@/lib/conversations";
import { getLeadByPhone } from "@/lib/leads";
import { extractAndWriteToPousada, alertManagerFormNotProcessed } from "@/lib/pousada-extractor";
import { processKanbanActions } from "@/lib/kanban-agent";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

// GET /api/guest-forms/[token] — público, sem autenticação (o token já é o segredo).
// Carrega os dados pra renderizar a página do formulário.
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  const form = getGuestFormByToken(token);
  if (!form) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  return NextResponse.json({
    clientName: form.clientName ?? null,
    status: form.status,
    pessoas: form.pessoas ?? null,
  });
}

// POST /api/guest-forms/[token] — público, o cliente envia os dados de cada hóspede.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  const form = getGuestFormByToken(token);
  if (!form) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  const { pessoas } = await req.json() as { pessoas?: GuestFormPessoa[] };
  const REQUIRED_FIELDS: (keyof GuestFormPessoa)[] = ["nome", "nascimento", "cpf", "rg", "endereco", "cidadeEstado", "telefone", "email"];
  const isComplete = (p: GuestFormPessoa) => REQUIRED_FIELDS.every((k) => p[k]?.trim());
  if (!Array.isArray(pessoas) || pessoas.length === 0 || pessoas.some((p) => !isComplete(p))) {
    return NextResponse.json({ error: "Preencha todos os campos de cada hóspede" }, { status: 400 });
  }

  const updated = submitGuestForm(token, pessoas);
  if (!updated) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  const resumoTexto = formatPessoasParaConversa(pessoas);

  // ── Cobrança determinística (preferida) ──────────────────────────────────
  // Em vez de depender da IA conversacional acertar "confirmar dados + repetir
  // valor + Pix" toda vez (já falhou várias vezes na prática — respostas
  // genéricas tipo "fico à disposição" sem valor nem Pix), quando o cliente
  // tem o sistema de Pousada habilitado E o Pix configurado, o PRÓPRIO CÓDIGO
  // extrai o valor da reserva e monta/envia essa mensagem — sem depender do
  // modelo de linguagem pra esse passo crítico. Cai no fluxo antigo (IA
  // conversacional) só quando falta alguma dessas condições.
  // ⚠️ NUNCA deixa uma exceção aqui derrubar a resposta inteira — se
  // tryChargeMessage() lançar por qualquer motivo, isso já aconteceu na
  // prática (Vitalli, 30/07/2026): o cliente preencheu o formulário, nada
  // apareceu na conversa (nem a cobrança automática, nem o fluxo antigo da
  // IA), porque a exceção não tratada interrompia o handler antes de chegar
  // no fallback abaixo. Trata como "não conseguiu" e sempre tenta o fallback.
  let sentDeterministically = false;
  try {
    sentDeterministically = await tryChargeMessage(form.clientId, form.phone, form.connId ?? null, resumoTexto);
  } catch (e) {
    console.error("[guest-forms] tryChargeMessage lançou exceção — caindo no fluxo antigo:", e instanceof Error ? e.stack ?? e.message : e);
  }

  if (!sentDeterministically) {
    // ── Fluxo antigo — "retoma" a conversa chamando o próprio webhook da
    // conexão, como se fosse uma mensagem normal do cliente, deixando a IA
    // conversacional responder do jeito dela.
    const appBaseUrl = getConfig().appBaseUrl?.replace(/\/$/, "");
    if (appBaseUrl && form.connId) {
      const { url, body } = buildResumePayload(appBaseUrl, form.connId, form.connType, form.phone, resumoTexto);
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch((e) => console.error("[guest-forms] erro ao retomar conversa:", e));
    } else {
      console.warn(`[guest-forms] Não foi possível retomar a conversa — appBaseUrl=${!!getConfig().appBaseUrl} connId=${form.connId}`);
    }
  }

  return NextResponse.json({ ok: true });
}

// Tenta o caminho determinístico: extrai o valor da reserva de hospedagem
// recém-completada e envia a cobrança (valor + Pix) diretamente, sem passar
// pela IA conversacional. Retorna true se conseguiu enviar, false se deve
// cair no fluxo antigo (IA responde na conversa normalmente).
async function tryChargeMessage(
  clientId: string,
  phone: string,
  connId: string | null,
  resumoTexto: string,
): Promise<boolean> {
  console.log(`[guest-forms] tryChargeMessage iniciando — clientId=${clientId} phone=${phone} connId=${connId}`);

  const client = getClientById(clientId);
  if (!client?.enabledSystems?.includes("pousada") || !client.pousadaTipos?.length) {
    console.log(`[guest-forms] tryChargeMessage: pousada não habilitada/sem tipos — clientId=${clientId}`);
    return false;
  }
  if (!client.pousadaPixChave?.trim() || !client.pousadaPixFavorecido?.trim()) {
    console.log(`[guest-forms] tryChargeMessage: Pix não configurado — clientId=${clientId}`);
    return false;
  }

  const tipoHospedagem = client.pousadaTipos.find((t) => t.categoria === "hospedagem");
  if (!tipoHospedagem) {
    console.log(`[guest-forms] tryChargeMessage: sem tipo categoria=hospedagem configurado — clientId=${clientId}`);
    return false;
  }

  const lead = getLeadByPhone(clientId, phone);
  const agentCfg = getAgentConfigForConnection(client, connId);
  const apiKey = getGeminiApiKey(agentCfg?.geminiApiKey ?? undefined);
  if (!apiKey) {
    console.log(`[guest-forms] tryChargeMessage: sem apiKey Gemini — clientId=${clientId} connId=${connId}`);
    return false;
  }

  // Grava a mensagem do cliente (dados do formulário) no histórico ANTES de
  // extrair — a extração lê o histórico completo pra montar a reserva.
  const historyAntes = getHistory(phone, clientId, connId ?? undefined);
  addMessage(phone, { role: "user", content: resumoTexto, ts: Date.now() }, clientId, { connId: connId ?? undefined });
  const historyDepois = getHistory(phone, clientId, connId ?? undefined);

  // Movimenta o Kanban normalmente (mesmo efeito que uma mensagem real do
  // WhatsApp teria) — não bloqueia o restante do fluxo.
  processKanbanActions(resumoTexto, historyAntes, clientId, phone, connId ?? undefined).catch(() => {});

  let valorTotal = 0;
  try {
    const affected = await extractAndWriteToPousada({
      apiKey,
      clientId,
      tipos: client.pousadaTipos,
      totalQuartos: client.pousadaTotalQuartos ?? 0,
      messages: historyDepois,
      phone,
      motivo: "DADOS RECEBIDOS: formulário de hóspedes preenchido",
    });
    const reserva = affected.find((r) => r.tipo === tipoHospedagem.slug) ?? affected[0];
    valorTotal = reserva?.valorTotal ?? 0;
  } catch (e) {
    console.error("[guest-forms] erro ao extrair reserva pra cobrança determinística:", e instanceof Error ? e.message : e);
  }

  if (!valorTotal) {
    // Não conseguiu determinar o valor (extração falhou ou não achou nada
    // reconhecível — ex: conversa longa/negociada manualmente pelo atendente,
    // com valores fora da tabela padrão). Em vez de só cair silenciosamente
    // no fluxo antigo da IA — que JÁ falhou nesse mesmo cenário na prática
    // (formulário preenchido, nada virou reserva, ninguém percebeu até o
    // hóspede reclamar) — avisa o gestor diretamente pra verificar na mão.
    console.warn(`[guest-forms] valorTotal não encontrado — alertando gestor e caindo no fluxo antigo (IA) — clientId=${clientId} phone=${phone}`);
    await alertManagerFormNotProcessed(client, connId, phone).catch((e) =>
      console.error("[guest-forms] erro ao alertar gestor sobre falha na extração:", e)
    );
    return false;
  }

  // IA pausada (atendente já assumiu a conversa manualmente): a reserva já
  // foi gravada acima (extractAndWriteToPousada roda sempre, pause ou não —
  // gravar dado é diferente de "a IA atender") — só não manda a cobrança
  // automática por cima do que o humano está conduzindo. Isso já causou
  // reserva perdida na prática (Vitalli, 20/08/2026): o pause vindo de uma
  // resposta manual ANTES do formulário chegar fazia a extração inteira ser
  // pulada, não só o envio da cobrança.
  if (lead?.aiPaused) {
    console.log(`[guest-forms] tryChargeMessage: lead com IA pausada — reserva já gravada, pulando cobrança automática — clientId=${clientId} phone=${phone}`);
    return true;
  }

  const entrada = Math.round(valorTotal * 0.5 * 100) / 100;
  const mensagem = `Recebi seus dados do formulário! 😊

Para garantirmos sua reserva, o próximo passo é o pagamento da entrada de 50% do valor total, que corresponde a R$ ${entrada.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.

Dados para o Pix:
Chave: ${client.pousadaPixChave}
Favorecido: ${client.pousadaPixFavorecido}

Após o pagamento, envie o comprovante aqui para que possamos confirmar sua reserva. 😊

⚠️ A reserva só é concluída após a confirmação do pagamento.`;

  const realPhone = lead?.realPhone ?? phone;
  // sendMessage() nunca pausa a IA (diferente do envio manual pelo inbox) —
  // é o próprio sistema falando, não um atendente assumindo a conversa, então
  // a IA deve continuar respondendo normalmente daqui pra frente.
  const ok = await sendMessage(realPhone, mensagem, clientId, connId ?? undefined);
  if (ok) {
    addMessage(phone, { role: "assistant", content: mensagem, ts: Date.now() }, clientId, { connId: connId ?? undefined });
  }
  return ok;
}

function buildResumePayload(
  appBaseUrl: string,
  connId: string,
  connType: string | null | undefined,
  phone: string,
  message: string,
): { url: string; body: unknown } {
  if (connType === "evolution") {
    // Formato Baileys/Evolution ("messages_upsert") — mesmo shape que o
    // webhook real recebe pra uma mensagem de texto simples do contato.
    return {
      url: `${appBaseUrl}/api/whatsapp/webhook/evolution/${connId}`,
      body: {
        event: "messages_upsert",
        data: {
          key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `guest-form-${Date.now()}` },
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

function formatPessoasParaConversa(pessoas: GuestFormPessoa[]): string {
  const blocos = pessoas.map((p, i) => {
    const linhas = [
      `${i + 1}. Nome completo: ${p.nome}`,
      p.nascimento ? `Data de nascimento: ${p.nascimento}` : null,
      p.cpf ? `CPF: ${p.cpf}` : null,
      p.rg ? `RG: ${p.rg}` : null,
      p.endereco ? `Endereço: ${p.endereco}` : null,
      p.cidadeEstado ? `Cidade/Estado: ${p.cidadeEstado}` : null,
      p.telefone ? `Telefone: ${p.telefone}` : null,
      p.email ? `E-mail: ${p.email}` : null,
    ].filter(Boolean);
    return linhas.join("\n");
  });
  return `Preenchi o formulário de hóspedes da hospedagem com os seguintes dados:\n\n${blocos.join("\n\n")}`;
}
