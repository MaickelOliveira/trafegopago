import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Atualiza a foto de perfil do WhatsApp Business via API oficial da Meta.
// Fluxo: 1) faz upload da imagem em /{phoneNumberId}/media (multipart) para
// obter um media handle; 2) atualiza o perfil em /{phoneNumberId}/whatsapp_business_profile
// referenciando esse handle.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  const phoneNumberId = formData.get("phoneNumberId");
  const token = formData.get("token");

  if (!(file instanceof File) || typeof phoneNumberId !== "string" || typeof token !== "string") {
    return NextResponse.json({ error: "file, phoneNumberId e token são obrigatórios" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "O arquivo deve ser uma imagem (jpg ou png)" }, { status: 400 });
  }

  // 1) Upload da mídia
  const uploadForm = new FormData();
  uploadForm.append("file", file, file.name);
  uploadForm.append("type", file.type);
  uploadForm.append("messaging_product", "whatsapp");

  const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: uploadForm,
  });
  const uploadBody = await uploadRes.text();
  if (!uploadRes.ok) {
    return NextResponse.json({ error: `Falha no upload da imagem: ${uploadBody}` }, { status: 502 });
  }
  let mediaId: string | undefined;
  try {
    mediaId = (JSON.parse(uploadBody) as { id?: string }).id;
  } catch {
    return NextResponse.json({ error: `Resposta inesperada da Meta no upload: ${uploadBody}` }, { status: 502 });
  }
  if (!mediaId) {
    return NextResponse.json({ error: "Meta não retornou um media id" }, { status: 502 });
  }

  // 2) Atualiza o perfil do WhatsApp Business com a foto enviada
  const profileRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/whatsapp_business_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: mediaId }),
  });
  const profileBody = await profileRes.text();
  if (!profileRes.ok) {
    return NextResponse.json({ error: `Falha ao atualizar perfil: ${profileBody}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
