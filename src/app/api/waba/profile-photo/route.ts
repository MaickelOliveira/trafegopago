import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

export const dynamic = "force-dynamic";

// Atualiza a foto de perfil do WhatsApp Business via API oficial da Meta.
// IMPORTANTE: foto de perfil exige a Resumable Upload API (graph.facebook.com/{appId}/uploads),
// não o endpoint comum /{phoneNumberId}/media (esse é só para mídia de mensagens — usá-lo
// aqui retorna "Parameter value is not valid" / code 131009 ao tentar setar profile_picture_handle).
// Fluxo correto:
//   1) POST /{appId}/uploads?file_length=N&file_type=image/jpeg  → { id: "upload:xxx" }
//   2) POST /{upload_session_id} com header file_offset:0 e o binário no corpo → { h: "<handle>" }
//   3) POST /{phoneNumberId}/whatsapp_business_profile com profile_picture_handle = handle
export async function POST(req: NextRequest) {
  console.log("[profile-photo] requisição recebida");
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = getConfig().metaAppId;
  if (!appId) {
    return NextResponse.json({ error: "metaAppId não configurado em Configurações" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: `Falha ao ler upload: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
  }
  const file = formData.get("file");
  const phoneNumberId = formData.get("phoneNumberId");
  const token = formData.get("token");
  console.log(`[profile-photo] file=${file instanceof File ? `${file.name} (${file.size} bytes)` : "ausente"} phoneNumberId=${phoneNumberId} appId=${appId}`);

  if (!(file instanceof File) || typeof phoneNumberId !== "string" || typeof token !== "string") {
    return NextResponse.json({ error: "file, phoneNumberId e token são obrigatórios" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "O arquivo deve ser uma imagem (jpg ou png)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // 1) Inicia a sessão de upload resumível
  let startRes: Response;
  try {
    startRes = await fetch(
      `https://graph.facebook.com/v19.0/${appId}/uploads?file_length=${buffer.length}&file_type=${encodeURIComponent(file.type)}&access_token=${encodeURIComponent(token)}`,
      { method: "POST" },
    );
  } catch (e) {
    return NextResponse.json({ error: `Erro de rede ao iniciar upload: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const startBody = await startRes.text();
  console.log(`[profile-photo] /uploads status=${startRes.status} body=${startBody.slice(0, 300)}`);
  if (!startRes.ok) {
    return NextResponse.json({ error: `Falha ao iniciar upload: ${startBody}` }, { status: 502 });
  }
  let uploadSessionId: string | undefined;
  try {
    uploadSessionId = (JSON.parse(startBody) as { id?: string }).id;
  } catch {
    return NextResponse.json({ error: `Resposta inesperada ao iniciar upload: ${startBody}` }, { status: 502 });
  }
  if (!uploadSessionId) {
    return NextResponse.json({ error: "Meta não retornou id de sessão de upload" }, { status: 502 });
  }

  // 2) Envia o binário da imagem para a sessão de upload
  let binRes: Response;
  try {
    binRes = await fetch(`https://graph.facebook.com/v19.0/${uploadSessionId}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
      body: buffer,
    });
  } catch (e) {
    return NextResponse.json({ error: `Erro de rede ao enviar binário: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const binBody = await binRes.text();
  console.log(`[profile-photo] upload binário status=${binRes.status} body=${binBody.slice(0, 300)}`);
  if (!binRes.ok) {
    return NextResponse.json({ error: `Falha ao enviar binário: ${binBody}` }, { status: 502 });
  }
  let handle: string | undefined;
  try {
    handle = (JSON.parse(binBody) as { h?: string }).h;
  } catch {
    return NextResponse.json({ error: `Resposta inesperada no upload binário: ${binBody}` }, { status: 502 });
  }
  if (!handle) {
    return NextResponse.json({ error: "Meta não retornou file handle" }, { status: 502 });
  }

  // 3) Atualiza o perfil do WhatsApp Business com o handle obtido
  let profileRes: Response;
  try {
    profileRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/whatsapp_business_profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: handle }),
    });
  } catch (e) {
    return NextResponse.json({ error: `Erro de rede ao atualizar perfil: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const profileBody = await profileRes.text();
  console.log(`[profile-photo] /whatsapp_business_profile status=${profileRes.status} body=${profileBody.slice(0, 300)}`);
  if (!profileRes.ok) {
    return NextResponse.json({ error: `Falha ao atualizar perfil: ${profileBody}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
