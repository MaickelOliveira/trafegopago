import { NextRequest, NextResponse } from "next/server";
import { getGuestFormByToken, submitGuestForm, type GuestFormPessoa } from "@/lib/guest-forms";
import { getConfig } from "@/lib/clients";

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
// Depois de salvar, injeta os dados como se fosse uma mensagem do cliente na
// MESMA conversa do WhatsApp — a IA processa normalmente (regra 15 do prompt:
// agradece, pede o pagamento e chama enviar_resumo), sem nenhum código novo
// de "retomada" — reaproveita 100% do pipeline já existente do webhook.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  const form = getGuestFormByToken(token);
  if (!form) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  const { pessoas } = await req.json() as { pessoas?: GuestFormPessoa[] };
  const REQUIRED_FIELDS: (keyof GuestFormPessoa)[] = ["nome", "nascimento", "cpf", "rg", "profissao", "endereco", "cidadeEstado", "telefone", "email"];
  const isComplete = (p: GuestFormPessoa) => REQUIRED_FIELDS.every((k) => p[k]?.trim());
  if (!Array.isArray(pessoas) || pessoas.length === 0 || pessoas.some((p) => !isComplete(p))) {
    return NextResponse.json({ error: "Preencha todos os campos de cada hóspede" }, { status: 400 });
  }

  const updated = submitGuestForm(token, pessoas);
  if (!updated) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  const resumoTexto = formatPessoasParaConversa(pessoas);

  // "Retoma" a conversa chamando o próprio webhook da conexão, como se fosse
  // uma mensagem normal do cliente — reusa toda a lógica de agente/pousada/
  // planilha já existente, sem duplicar nada disso aqui.
  const appBaseUrl = getConfig().appBaseUrl?.replace(/\/$/, "");
  if (appBaseUrl && form.connId) {
    fetch(`${appBaseUrl}/api/whatsapp/webhook/${form.connId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: form.phone, message: resumoTexto }),
    }).catch((e) => console.error("[guest-forms] erro ao retomar conversa:", e));
  } else {
    console.warn(`[guest-forms] Não foi possível retomar a conversa — appBaseUrl=${!!appBaseUrl} connId=${form.connId}`);
  }

  return NextResponse.json({ ok: true });
}

function formatPessoasParaConversa(pessoas: GuestFormPessoa[]): string {
  const blocos = pessoas.map((p, i) => {
    const linhas = [
      `${i + 1}. Nome completo: ${p.nome}`,
      p.nascimento ? `Data de nascimento: ${p.nascimento}` : null,
      p.cpf ? `CPF: ${p.cpf}` : null,
      p.rg ? `RG: ${p.rg}` : null,
      p.profissao ? `Profissão: ${p.profissao}` : null,
      p.endereco ? `Endereço: ${p.endereco}` : null,
      p.cidadeEstado ? `Cidade/Estado: ${p.cidadeEstado}` : null,
      p.telefone ? `Telefone: ${p.telefone}` : null,
      p.email ? `E-mail: ${p.email}` : null,
    ].filter(Boolean);
    return linhas.join("\n");
  });
  return `Preenchi o formulário de hóspedes da hospedagem com os seguintes dados:\n\n${blocos.join("\n\n")}`;
}
