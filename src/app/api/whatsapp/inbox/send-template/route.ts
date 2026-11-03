import { getFunnels } from "@/lib/funnels";
import { NextRequest, NextResponse } from "next/server";
import { getTemplateById, sendTemplate, type WabaTemplate } from "@/lib/waba-templates";
import { addMessage, setAiPaused, getAllConversationsByClientId, getHistory, phoneVariants } from "@/lib/conversations";
import { updateLead } from "@/lib/leads";
import { getLeadForConnection } from "@/lib/lead-context";
import { cancelPendingForPhone } from "@/lib/pending-responses";
import { cancelFollowUpsForPhone } from "@/lib/followups";

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

  const tpl = (await getTemplateById(templateId));
  if (!tpl || tpl.clientId !== clientId) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }
  if (tpl.status !== "APPROVED") {
    return NextResponse.json({ error: "Template não aprovado" }, { status: 422 });
  }
  if (!tpl.phoneNumberId || !tpl.metaToken) {
    return NextResponse.json({ error: "Template sem número/token configurados" }, { status: 422 });
  }

  const sources = (await getFunnels()).filter(funnel => funnel.clientId === clientId).flatMap(funnel => funnel.connections ?? []).filter(connection => connection.type === "meta" && connection.metaPhoneNumberId === tpl.phoneNumberId && (!connId || connection.id === connId));
  if (sources.length !== 1) return NextResponse.json({ error: "Selecione a conexão oficial que pertence a este template." }, { status: 422 });
  const sourceConnectionId = sources[0].id;
  if(funnelId && !(await getFunnels()).some(funnel=>funnel.id===funnelId&&funnel.connections?.some(connection=>connection.id===sourceConnectionId)))return NextResponse.json({error:"O template pertence a outro funil."},{status:422});
  const digits = phone.replace(/\D/g, "");
  const cleanPhone = digits.startsWith("55") ? digits : "55" + digits;

  const result = await sendTemplate(tpl.phoneNumberId, tpl.metaToken, cleanPhone, tpl.name, tpl.language, components);
  if (!result.success) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  const activeConnId = sourceConnectionId;
  const previewText = `📋 ${renderPreview(tpl, components)}`;
  (await addMessage(cleanPhone, { role: "assistant", content: previewText, ts: Date.now(), type: "text" }, clientId, activeConnId ? { connId: activeConnId } : undefined));
  (await setAiPaused(cleanPhone, true, clientId, activeConnId ?? null));
  const existingLead = (await getLeadForConnection(clientId, cleanPhone,activeConnId));
  if (existingLead) (await updateLead(existingLead.id, { aiPaused: true }));
  // Cancela follow-ups automáticos já agendados — sem isso, um follow-up
  // agendado antes do gestor assumir dispara depois e reativa a IA sozinho
  // (ver mesmo comentário em /api/whatsapp/inbox/send/route.ts).
  await cancelPendingForPhone(clientId,cleanPhone,activeConnId);
  (await cancelFollowUpsForPhone(clientId, cleanPhone, activeConnId));

  return NextResponse.json({ ok: true });
}
