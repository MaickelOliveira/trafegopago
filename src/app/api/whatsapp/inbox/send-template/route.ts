import { NextRequest, NextResponse } from "next/server";
import { getTemplateById, sendTemplate, type WabaTemplate } from "@/lib/waba-templates";
import { addMessage, setAiPaused, getAllConversationsByClientId, getHistory } from "@/lib/conversations";
import { getLeadByPhone, updateLead } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { getWppSessions } from "@/lib/wppconnect-sessions";

export const dynamic = "force-dynamic";

type SendComponent = { type: string; parameters: { type: "text"; text: string }[] };

function renderPreview(tpl: WabaTemplate, components?: SendComponent[]): string {
  const parts: string[] = [];
  for (const comp of tpl.components) {
    if (comp.type === "BUTTONS" || !comp.text) continue;
    const sendComp = components?.find((c) => c.type.toUpperCase() === comp.type);
    const params = sendComp?.parameters ?? [];
    const text = comp.text.replace(/\{\{(\d+)\}\}/g, (m, n) => params[parseInt(n) - 1]?.text ?? m);
    parts.push(text);
  }
  return parts.join("\n\n");
}

/**
 * Envia um template aprovado da API Oficial para um lead específico (via inbox/CRM)
 * e registra a mensagem no histórico da conversa.
 * Body: { templateId, phone, clientId, connId?, funnelId?, components? }
 */
export async function POST(req: NextRequest) {
  const { templateId, phone, clientId, connId, funnelId, components } = await req.json() as {
    templateId: string;
    phone: string;
    clientId: string;
    connId?: string;
    funnelId?: string;
    components?: SendComponent[];
  };

  if (!templateId || !phone || !clientId) {
    return NextResponse.json({ error: "templateId, phone e clientId são obrigatórios" }, { status: 400 });
  }

  const tpl = getTemplateById(templateId);
  if (!tpl || tpl.clientId !== clientId) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }
  if (tpl.status !== "APPROVED") {
    return NextResponse.json({ error: "Template não aprovado" }, { status: 422 });
  }
  if (!tpl.phoneNumberId || !tpl.metaToken) {
    return NextResponse.json({ error: "Template sem número/token configurados" }, { status: 422 });
  }

  const digits = phone.replace(/\D/g, "");
  const cleanPhone = digits.startsWith("55") ? digits : "55" + digits;

  const result = await sendTemplate(tpl.phoneNumberId, tpl.metaToken, cleanPhone, tpl.name, tpl.language, components);
  if (!result.success) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  // Resolve connId — replica a mesma ordem de prioridade usada por /api/crm/conversations/[phone]
  // (GET) para garantir que a mensagem seja salva na mesma chave que o chat irá reler.
  let activeConnId = connId;
  if (!activeConnId && funnelId) {
    const wppSession = getWppSessions().find((s) => s.funnelId === funnelId);
    const funnelConnId = wppSession?.id
      ?? getFunnelById(funnelId)?.connections?.find((c) => c.type === "uazapi")?.id
      ?? getFunnelById(funnelId)?.connections?.[0]?.id;
    if (funnelConnId && getHistory(cleanPhone, clientId, funnelConnId).length > 0) {
      activeConnId = funnelConnId;
    }
  }
  if (!activeConnId) {
    const tail9 = cleanPhone.slice(-9);
    const matched = getAllConversationsByClientId(clientId)
      .filter((c) => {
        const d = c.phone.replace(/\D/g, "");
        return d === cleanPhone || d.endsWith(tail9) || cleanPhone.endsWith(d.slice(-9));
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);
    activeConnId = matched.find((c) => getHistory(c.phone, clientId, c.connId ?? undefined).length > 0)?.connId ?? undefined;
  }

  const previewText = `📋 ${renderPreview(tpl, components)}`;
  addMessage(cleanPhone, { role: "assistant", content: previewText, ts: Date.now(), type: "text" }, clientId, activeConnId ? { connId: activeConnId } : undefined);
  setAiPaused(cleanPhone, true, clientId, activeConnId ?? null);
  const existingLead = getLeadByPhone(clientId, cleanPhone);
  if (existingLead) updateLead(existingLead.id, { aiPaused: true });

  return NextResponse.json({ ok: true });
}
