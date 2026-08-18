import { NextRequest, NextResponse } from "next/server";
import { getServicoFormByToken, submitServicoForm, type ServicoFormPessoa } from "@/lib/servico-forms";
import { getConfig } from "@/lib/clients";

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

  // Retoma a conversa chamando o próprio webhook da conexão, como se fosse
  // uma mensagem normal do cliente — a IA calcula o valor/Pix normalmente
  // pelo fluxo conversacional já existente de Day Use/Almoço/eventos (este
  // formulário não carrega preço, diferente do de hóspedes de hospedagem).
  const resumoTexto = formatPessoasParaConversa(pessoas);
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
