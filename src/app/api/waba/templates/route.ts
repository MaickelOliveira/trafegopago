import { NextRequest, NextResponse } from "next/server";
import { getTemplates, createTemplate, syncTemplateStatus } from "@/lib/waba-templates";
import { getFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? undefined;
  const sync = req.nextUrl.searchParams.get("sync") === "1";
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
