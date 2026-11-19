import { getSession } from "@/lib/auth";
import { publicTemplate } from "@/lib/public-records";
import { NextResponse } from "next/server";
import { getTemplateById, deleteTemplate, syncTemplateStatus, updateTemplate } from "@/lib/waba-templates";
import type { TemplateStatus } from "@/lib/waba-templates";

export const dynamic = "force-dynamic";

/** Sincroniza status com Meta e retorna template atualizado */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tpl = (await getTemplateById(id));
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await syncTemplateStatus(tpl);
  return NextResponse.json(publicTemplate(updated));
}

/** Envia template existente para aprovação da Meta (DRAFT → PENDING) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tpl = (await getTemplateById(id));
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const manager = (await getSession())?.role === "manager";
  const wabaId = manager ? body.wabaId ?? tpl.wabaId : tpl.wabaId;
  const metaToken = manager ? body.metaToken || tpl.metaToken : tpl.metaToken;
  if (wabaId && !/^\d+$/.test(wabaId)) return NextResponse.json({ error: "Conta inválida." }, { status: 400 });

  if (!wabaId || !metaToken) {
    return NextResponse.json({ error: "wabaId e metaToken são necessários" }, { status: 400 });
  }

  const metaBody = {
    name: tpl.name,
    category: tpl.category,
    language: tpl.language,
    components: tpl.components,
  };
  const metaRes = await fetch(`https://graph.facebook.com/v26.0/${wabaId}/message_templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${metaToken}` },
    body: JSON.stringify(metaBody),
  });

  if (metaRes.ok) {
    const data = await metaRes.json() as { id: string; status: string };
    const updated = (await updateTemplate(id, {
      metaId: data.id,
      wabaId,
      metaToken,
      status: (data.status?.toUpperCase() as "PENDING") ?? "PENDING",
    }));
    return NextResponse.json(publicTemplate(updated));
  } else {
    const errText = await metaRes.text();
    return NextResponse.json({ error: errText }, { status: 502 });
  }
}

/** Atualiza conteúdo do template localmente e opcionalmente reenvia para Meta */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tpl = (await getTemplateById(id));
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { components, category, language, wabaId, phoneNumberId, metaToken, submitToMeta } = body;

  const manager = (await getSession())?.role === "manager";
  const effectiveWabaId = manager ? wabaId ?? tpl.wabaId : tpl.wabaId;
  const effectiveToken = manager ? metaToken || tpl.metaToken : tpl.metaToken;
  if (effectiveWabaId && !/^\d+$/.test(effectiveWabaId)) return NextResponse.json({ error: "Conta inválida." }, { status: 400 });

  const patch: Parameters<typeof updateTemplate>[1] = {
    ...(components && { components }),
    ...(category && { category }),
    ...(language && { language }),
    ...(manager && wabaId && { wabaId }),
    ...(manager && phoneNumberId && { phoneNumberId }),
    ...(manager && metaToken && { metaToken }),
  };

  if (submitToMeta && effectiveWabaId && effectiveToken) {
    const metaBody = {
      name: tpl.name,
      category: patch.category ?? tpl.category,
      language: patch.language ?? tpl.language,
      components: patch.components ?? tpl.components,
    };
    const metaRes = await fetch(`https://graph.facebook.com/v26.0/${effectiveWabaId}/message_templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${effectiveToken}` },
      body: JSON.stringify(metaBody),
    });
    if (metaRes.ok) {
      const data = await metaRes.json() as { id: string; status: string };
      patch.metaId = data.id;
      patch.status = (data.status?.toUpperCase() as TemplateStatus) ?? "PENDING";
    } else {
      const errText = await metaRes.text();
      return NextResponse.json({ error: errText }, { status: 502 });
    }
  }

  const updated = (await updateTemplate(id, patch));
  return NextResponse.json(publicTemplate(updated));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = (await deleteTemplate(id));
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
