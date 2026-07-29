import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getClientById, getConfig } from "@/lib/clients";
import { createGuestForm, type GuestFormConnType } from "@/lib/guest-forms";

export const dynamic = "force-dynamic";

// Gera o link do formulário de hóspedes manualmente pela tela da Pousada — usado
// quando a IA está pausada e o atendente está conduzindo a reserva de
// hospedagem na mão: sem isso, só a IA (via marcador [FORMULARIO_HOSPEDAGEM]
// no prompt) conseguia gerar o link.
export async function POST(req: NextRequest) {
  const { phone, clientId, connId } = (await req.json()) as {
    phone?: string;
    clientId?: string;
    connId?: string | null;
  };

  if (!phone || !clientId) {
    return NextResponse.json({ error: "phone e clientId são obrigatórios" }, { status: 400 });
  }

  const digits = phone.replace(/\D/g, "");
  const cleanPhone = digits.startsWith("55") ? digits : "55" + digits;

  // Mesma detecção de tipo de conexão usada em sendMessage() (whatsapp-send.ts)
  // — sessões WPPConnect/Evolution ficam em stores separados, fora de
  // funnels[].connections.
  function resolveConnType(id: string): GuestFormConnType | null {
    if (getEvolutionSessions().some((s) => s.id === id)) return "evolution";
    if (getWppSessions().some((s) => s.id === id)) return null; // ver bloqueio abaixo
    const funnels = getFunnels().filter((f) => f.clientId === clientId);
    const conn = funnels.flatMap((f) => f.connections ?? []).find((c) => c.id === id);
    return conn?.type === "uazapi" ? "uazapi" : null;
  }

  let resolvedConnId = connId ?? null;
  let connType: GuestFormConnType | null = null;

  if (resolvedConnId) {
    if (getWppSessions().some((s) => s.id === resolvedConnId)) {
      // A retomada automática (POST /api/guest-forms/[token]) ainda não sabe
      // montar o payload sintético no formato que o webhook do WPPConnect
      // espera (ver buildResumePayload) — bloqueado aqui até isso existir,
      // pra não gerar um link cujo preenchimento silenciosamente falha em
      // retomar a conversa.
      return NextResponse.json(
        { error: "Link manual ainda não é suportado para conexões WPPConnect." },
        { status: 400 },
      );
    }
    connType = resolveConnType(resolvedConnId);
  } else {
    // Sem connId explícito (não há tela de conversa aqui, na Pousada) —
    // auto-detecta a primeira conexão elegível (Evolution ou UazAPI)
    // vinculada aos funis deste cliente.
    const funnels = getFunnels().filter((f) => f.clientId === clientId);
    const clientFunnelIds = new Set(funnels.map((f) => f.id));

    const evo = getEvolutionSessions().find((s) => s.funnelId && clientFunnelIds.has(s.funnelId));
    const uazConn = funnels.flatMap((f) => f.connections ?? []).find((c) => c.type === "uazapi");

    if (evo) {
      resolvedConnId = evo.id;
      connType = "evolution";
    } else if (uazConn) {
      resolvedConnId = uazConn.id;
      connType = "uazapi";
    }
  }

  if (!connType || !resolvedConnId) {
    return NextResponse.json(
      { error: "Nenhuma conexão UazAPI ou Evolution encontrada para este cliente." },
      { status: 400 },
    );
  }

  const appBaseUrl = getConfig().appBaseUrl?.replace(/\/$/, "");
  if (!appBaseUrl) {
    return NextResponse.json(
      { error: "appBaseUrl não configurado nas Configurações — necessário para gerar o link público." },
      { status: 400 },
    );
  }

  const client = getClientById(clientId);
  const form = createGuestForm({
    clientId,
    clientName: client?.name,
    phone: cleanPhone,
    connId: resolvedConnId,
    connType,
  });

  return NextResponse.json({ ok: true, url: `${appBaseUrl}/formulario-hospede/${form.id}` });
}
