import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resetAiContext } from "@/lib/conversations";

export const dynamic = "force-dynamic";

// POST /api/crm/reset-ai-context — gestor only. "Esquece" o histórico da
// conversa pro lado da IA (usado em testes), sem apagar a conversa exibida
// no chat/inbox — ver resetAiContext() em @/lib/conversations.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { phone, clientId, connId } = await req.json() as {
    phone?: string;
    clientId?: string;
    connId?: string;
  };
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const resetAt = resetAiContext(phone, clientId ?? null, connId ?? null);
  return NextResponse.json({ ok: true, resetAt });
}
