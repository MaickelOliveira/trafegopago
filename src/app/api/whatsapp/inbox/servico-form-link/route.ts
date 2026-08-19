import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { getEvolutionSessions } from "@/lib/evolution-sessions";
import { getClientById, getConfig } from "@/lib/clients";
import { createServicoForm, type ServicoFormConnType } from "@/lib/servico-forms";

export const dynamic = "force-dynamic";

// Gera o link do formulário de serviços manualmente pela tela da Pousada —
// mesmo mecanismo de /api/whatsapp/inbox/guest-form-link, usado quando a IA
// está pausada e o atendente está conduzindo a reserva de Day Use/Almoço/
// outro serviço na mão.
export async function POST(req: NextRequest) {
  const { phone, clientId, connId, tipoSlug } = (await req.json()) as {
    phone?: string;
    clientId?: string;
    connId?: string | null;
    tipoSlug?: string;
  };

  if (!phone || !clientId) {
    return NextResponse.json({ error: "phone e clientId são obrigatórios" }, { status: 400 });
  }

  const digits = phone.replace(/\D/g, "");
  const cleanPhone = digits.startsWith("55") ? digits : "55" + digits;

  function resolveConnType(id: string): ServicoFormConnType | null {
    if (getEvolutionSessions().some((s) => s.id === id)) return "evolution";
    if (getWppSessions().some((s) => s.id === id)) return null;
    const funnels = getFunnels().filter((f) => f.clientId === clientId);
    const conn = funnels.flatMap((f) => f.connections ?? []).find((c) => c.id === id);
    return conn?.type === "uazapi" ? "uazapi" : null;
  }

  let resolvedConnId = connId ?? null;
  let connType: ServicoFormConnType | null = null;

  if (resolvedConnId) {
    if (getWppSessions().some((s) => s.id === resolvedConnId)) {
      return NextResponse.json(
        { error: "Link manual ainda não é suportado para conexões WPPConnect." },
        { status: 400 },
      );
    }
    connType = resolveConnType(resolvedConnId);
  } else {
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
  const tipoInfo = tipoSlug ? client?.pousadaTipos?.find((t) => t.slug === tipoSlug) : undefined;
  const form = createServicoForm({
    clientId,
    clientName: client?.name,
    phone: cleanPhone,
    connId: resolvedConnId,
    connType,
    tipoSlug: tipoInfo?.slug,
    tipoLabel: tipoInfo?.label,
  });

  return NextResponse.json({ ok: true, url: `${appBaseUrl}/formulario-servico/${form.id}` });
}
