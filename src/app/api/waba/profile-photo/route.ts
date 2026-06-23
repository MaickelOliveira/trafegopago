import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Atualiza a foto de perfil do WhatsApp Business via API oficial da Meta.
// Fluxo: 1) faz upload da imagem em /{phoneNumberId}/media (multipart) para
// obter um media handle; 2) atualiza o perfil em /{phoneNumberId}/whatsapp_business_profile
// referenciando esse handle.
export async function POST(req: NextRequest) {
  console.log("[profile-photo] requisição recebida");
  const session = await getSession();
  if (!session) {
    console.log("[profile-photo] Unauthorized — sem sessão válida");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error("[profile-photo] ERRO ao ler formData:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: `Falha ao ler upload: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
  }
  const file = formData.get("file");
  const phoneNumberId = formData.get("phoneNumberId");
  const token = formData.get("token");
  console.log(`[profile-photo] file=${file instanceof File ? `${file.name} (${file.size} bytes)` : "ausente"} phoneNumberId=${phoneNumberId} hasToken=${!!token}`);

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

  console.log(`[profile-photo] chamando Meta /media — phoneNumberId=${phoneNumberId}`);
  let uploadRes: Response;
  try {
    uploadRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: uploadForm,
    });
  } catch (e) {
    console.error("[profile-photo] ERRO de rede ao chamar Meta /media:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: `Erro de rede ao chamar a Meta: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const uploadBody = await uploadRes.text();
  console.log(`[profile-photo] Meta /media status=${uploadRes.status} body=${uploadBody.slice(0, 300)}`);
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
  console.log(`[profile-photo] chamando Meta /whatsapp_business_profile — mediaId=${mediaId}`);
  let profileRes: Response;
  try {
    profileRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/whatsapp_business_profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: mediaId }),
    });
  } catch (e) {
    console.error("[profile-photo] ERRO de rede ao chamar Meta /whatsapp_business_profile:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: `Erro de rede ao atualizar perfil: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const profileBody = await profileRes.text();
  console.log(`[profile-photo] Meta /whatsapp_business_profile status=${profileRes.status} body=${profileBody.slice(0, 300)}`);
  if (!profileRes.ok) {
    return NextResponse.json({ error: `Falha ao atualizar perfil: ${profileBody}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
