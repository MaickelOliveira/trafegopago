import { NextRequest, NextResponse } from "next/server";
import { getTemplateById } from "@/lib/waba-templates";
import { sendTemplate } from "@/lib/waba-templates";
import { getLeads } from "@/lib/leads";

export const dynamic = "force-dynamic";

/**
 * Envia um template aprovado para um ou múltiplos números.
 * Body: { templateId, phones: string[] | "all", clientId?, funnelId?, columnId? }
 * columnId: filtra leads por etapa/coluna do kanban (lead.status === columnId).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { templateId, phones, clientId, funnelId, columnId, components } = body;

  if (!templateId) return NextResponse.json({ error: "templateId é obrigatório" }, { status: 400 });

  const tpl = getTemplateById(templateId);
  if (!tpl) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  if (tpl.status !== "APPROVED") return NextResponse.json({ error: "Template não aprovado" }, { status: 422 });

  const phoneNumberId = tpl.phoneNumberId;
  const metaToken = tpl.metaToken;
  if (!phoneNumberId || !metaToken) {
    return NextResponse.json({ error: "phoneNumberId e metaToken não configurados no template" }, { status: 422 });
  }

  function withCountryCode(p: string) {
    const digits = p.replace(/\D/g, "");
    return digits.startsWith("55") ? digits : "55" + digits;
  }

  let targetPhones: string[] = [];

  if (phones === "all" && clientId) {
    // Todos os leads do cliente (filtrando por funil e/ou etapa kanban se especificados)
    const leads = getLeads(clientId).filter((l) => {
      if (funnelId && l.funnelId !== funnelId) return false;
      if (columnId && l.status !== columnId) return false;
      return !!l.phone;
    });
    targetPhones = leads.map((l) => withCountryCode(l.phone));
  } else if (Array.isArray(phones)) {
    targetPhones = phones.map(withCountryCode);
  } else {
    return NextResponse.json({ error: "phones deve ser um array ou 'all'" }, { status: 400 });
  }

  if (targetPhones.length === 0) {
    return NextResponse.json({ error: "Nenhum telefone para enviar" }, { status: 422 });
  }

  const results: { phone: string; success: boolean; error?: string }[] = [];
  for (const phone of targetPhones) {
    const r = await sendTemplate(phoneNumberId, metaToken, phone, tpl.name, tpl.language, components);
    results.push({ phone, ...r });
    // Rate limit — 1 envio por segundo para não throttle
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const successCount = results.filter((r) => r.success).length;
  return NextResponse.json({ sent: successCount, total: targetPhones.length, results });
}
