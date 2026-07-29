import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getClientById, getConfig } from "@/lib/clients";
import { createGuestForm, type GuestFormConnType } from "@/lib/guest-forms";

export const dynamic = "force-dynamic";

// Gera o link do formulário de hóspedes manualmente pelo inbox — usado quando
// a IA está pausada e o atendente está conduzindo a reserva de hospedagem na
// mão: sem isso, só a IA (via marcador [FORMULARIO_HOSPEDAGEM] no prompt)
// conseguia gerar o link, então uma conversa assumida manualmente nunca tinha
// como oferecer o formulário ao cliente.
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
  let connType: GuestFormConnType | null = null;
  if (connId) {
    if (getEvolutionSessions().some((s) => s.id === connId)) {
      connType = "evolution";
    } else if (getWppSessions().some((s) => s.id === connId)) {
      // A retomada automática (POST /api/guest-forms/[token]) ainda não sabe
      // montar o payload sintético no formato que o webhook do WPPConnect
      // espera (ver buildResumePayload) — bloqueado aqui até isso existir,
      // pra não gerar um link cujo preenchimento silenciosamente falha em
      // retomar a conversa.
      return NextResponse.json(
        { error: "Link manual ainda não é suportado para conexões WPPConnect." },
        { status: 400 },
      );
    } else {
      const funnels = getFunnels().filter((f) => f.clientId === clientId);
      const conn = funnels.flatMap((f) => f.connections ?? []).find((c) => c.id === connId);
      if (conn?.type === "uazapi") connType = "uazapi";
    }
  }

  if (!connType) {
    return NextResponse.json(
      { error: "Link manual só é suportado para conexões UazAPI ou Evolution." },
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
    connId: connId ?? null,
    connType,
  });

  return NextResponse.json({ ok: true, url: `${appBaseUrl}/formulario-hospede/${form.id}` });
}
