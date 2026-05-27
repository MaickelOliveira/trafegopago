import { NextRequest, NextResponse } from "next/server";
import { getBriefingByToken, submitBriefing } from "@/lib/briefings";
import { getConfig } from "@/lib/clients";
import { sendText } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

// GET /api/briefing/[token] — público, retorna dados do briefing para preencher o formulário
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const briefing = getBriefingByToken(token);

  if (!briefing) {
    return NextResponse.json({ error: "Briefing não encontrado" }, { status: 404 });
  }

  if (briefing.status === "submitted") {
    return NextResponse.json({ error: "Este briefing já foi preenchido." }, { status: 410 });
  }

  return NextResponse.json({
    clientName: briefing.clientName,
    niche: briefing.niche ?? null,
  });
}

// POST /api/briefing/[token] — público, salva respostas e notifica gestor via WhatsApp
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const briefing = getBriefingByToken(token);

  if (!briefing) {
    return NextResponse.json({ error: "Briefing não encontrado" }, { status: 404 });
  }

  if (briefing.status === "submitted") {
    return NextResponse.json({ error: "Este briefing já foi preenchido." }, { status: 410 });
  }

  const { answers } = await req.json() as { answers: Record<string, string> };
  if (!answers || typeof answers !== "object") {
    return NextResponse.json({ error: "answers inválido" }, { status: 400 });
  }

  const updated = submitBriefing(token, answers);
  if (!updated) {
    return NextResponse.json({ error: "Erro ao salvar briefing" }, { status: 500 });
  }

  // Notificação via WhatsApp
  try {
    const config = getConfig();
    const uazToken = config.uazapiToken;
    if (uazToken && briefing.notifyPhone) {
      const baseUrl = req.nextUrl.origin;
      const viewUrl = `${baseUrl}/gestor/${briefing.clientId}/briefings`;
      const niche = answers["nicho"] ?? briefing.niche ?? "não informado";
      const msg =
        `📋 *Novo briefing preenchido!*\n\n` +
        `👤 *Cliente:* ${briefing.clientName}\n` +
        `🏷️ *Nicho:* ${niche}\n\n` +
        `Acesse a plataforma para ver as respostas e gerar o prompt:\n${viewUrl}`;
      await sendText(uazToken, briefing.notifyPhone.replace(/\D/g, ""), msg);
    }
  } catch (e) {
    console.error("[briefing] Erro ao enviar notificação WhatsApp:", e);
    // Não falha a request — briefing já foi salvo
  }

  return NextResponse.json({ ok: true });
}
