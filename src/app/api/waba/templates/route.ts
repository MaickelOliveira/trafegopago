import { NextRequest, NextResponse } from "next/server";
import { getTemplates, createTemplate, syncTemplateStatus, type TemplateLanguage } from "@/lib/waba-templates";
import { getFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const sync = req.nextUrl.searchParams.get("sync") === "1";

  // Importar templates existentes do Meta (não cadastrados ainda)
  const importWabaId  = req.nextUrl.searchParams.get("importWabaId");
  const importToken   = req.nextUrl.searchParams.get("importToken");
  const importPhoneId = req.nextUrl.searchParams.get("importPhoneId");
  if (importWabaId && importToken && clientId) {
    const url = `https://graph.facebook.com/v19.0/${importWabaId}/message_templates?fields=name,status,category,language,components,rejected_reason&limit=200&access_token=${importToken}`;
    let metaRes: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      metaRes = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError" ? "Timeout: Meta API demorou mais de 15s." : String(e);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    if (!metaRes.ok) {
      const text = await metaRes.text();
      let metaError = text;
      try { metaError = JSON.parse(text)?.error?.message ?? text; } catch { /* keep text */ }
      return NextResponse.json({ error: `Meta API ${metaRes.status}: ${metaError}` }, { status: 502 });
    }
    const metaData = await metaRes.json() as { data: { id: string; name: string; status: string; category: string; language: string; components: object[]; rejected_reason?: string }[] };
    const existing = getTemplates(clientId).map((t) => t.metaId);
    const imported: ReturnType<typeof createTemplate>[] = [];
    for (const mt of metaData.data ?? []) {
      if (existing.includes(mt.id)) continue; // já importado
      const tpl = createTemplate({
        clientId,
        name: mt.name,
        category: (mt.category as "MARKETING" | "UTILITY") ?? "MARKETING",
        language: mt.language as TemplateLanguage,
        components: mt.components as Parameters<typeof createTemplate>[0]["components"],
        status: (mt.status as "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DRAFT") ?? "DRAFT",
        metaId: mt.id,
        wabaId: importWabaId,
        phoneNumberId: importPhoneId ?? undefined,
        metaToken: importToken,
        rejectedReason: mt.rejected_reason ?? undefined,
      });
      imported.push(tpl);
    }
    return NextResponse.json({ imported: imported.length, templates: getTemplates(clientId) });
  }

  let templates = getTemplates(clientId);

  if (sync) {
    templates = await Promise.all(templates.map((t) => syncTemplateStatus(t)));
  }

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, name, category, language, components, wabaId, phoneNumberId, metaToken, submitToMeta } = body;

  if (!clientId || !name || !category || !language || !components) {
    return NextResponse.json({ error: "clientId, name, category, language, components são obrigatórios" }, { status: 400 });
  }

  // Nome deve ser snake_case sem espaços
  const safeName = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  let tpl = createTemplate({
    clientId,
    name: safeName,
    category,
    language,
    components,
    status: "DRAFT",
    wabaId: wabaId ?? undefined,
    phoneNumberId: phoneNumberId ?? undefined,
    metaToken: metaToken ?? undefined,
  });

  // Enviar para aprovação da Meta agora?
  if (submitToMeta && wabaId && metaToken) {
    try {
      const metaBody = {
        name: safeName,
        category,
        language,
        components: components.map((c: { type: string; format?: string; text?: string; buttons?: object[] }) => ({
          type: c.type,
          ...(c.format ? { format: c.format } : {}),
          ...(c.text ? { text: c.text } : {}),
          ...(c.buttons ? { buttons: c.buttons } : {}),
        })),
      };
      const metaRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${metaToken}` },
        body: JSON.stringify(metaBody),
      });
      if (metaRes.ok) {
        const metaData = await metaRes.json() as { id: string; status: string };
        const { updateTemplate } = await import("@/lib/waba-templates");
        tpl = updateTemplate(tpl.id, {
          metaId: metaData.id,
          status: (metaData.status?.toUpperCase() as "PENDING") ?? "PENDING",
        }) ?? tpl;
      } else {
        const errText = await metaRes.text();
        const { updateTemplate } = await import("@/lib/waba-templates");
        tpl = updateTemplate(tpl.id, { status: "REJECTED", rejectedReason: errText }) ?? tpl;
      }
    } catch (e) {
      console.error("[waba/templates] Erro ao enviar para Meta:", e);
    }
  }

  return NextResponse.json(tpl, { status: 201 });
}
