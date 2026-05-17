import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { getCreativeById, updateCreative } from "@/lib/creatives";

const BASE = "https://graph.facebook.com/v19.0";
type Params = { params: Promise<{ id: string }> };

async function getPageId(accountId: string, token: string): Promise<string | null> {
  // Busca a partir de um ad existente na conta
  const res = await fetch(
    `${BASE}/${accountId}/ads?fields=creative{object_story_spec}&limit=1&access_token=${token}`
  );
  const d = await res.json();
  const spec = d.data?.[0]?.creative?.object_story_spec;
  return spec?.page_id || null;
}

async function uploadImage(accountId: string, token: string, filePath: string): Promise<string> {
  const absolutePath = path.join(process.cwd(), "public", filePath);
  const fileBuffer = readFileSync(absolutePath);
  const filename = path.basename(filePath);

  const form = new FormData();
  form.append("filename", filename);
  form.append("bytes", new Blob([fileBuffer]), filename);
  form.append("access_token", token);

  const res = await fetch(`${BASE}/${accountId}/adimages`, { method: "POST", body: form });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const images = data.images || {};
  const first = Object.values(images)[0] as { hash: string };
  return first.hash;
}

async function uploadVideo(accountId: string, token: string, filePath: string): Promise<string> {
  const absolutePath = path.join(process.cwd(), "public", filePath);
  const fileBuffer = readFileSync(absolutePath);
  const filename = path.basename(filePath);

  const form = new FormData();
  form.append("title", filename);
  form.append("source", new Blob([fileBuffer], { type: "video/mp4" }), filename);
  form.append("access_token", token);

  const res = await fetch(`${BASE}/${accountId}/advideos`, { method: "POST", body: form });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.id;
}

async function uploadImageFromUrl(accountId: string, token: string, url: string): Promise<string> {
  const params = new URLSearchParams({ bytes_url: url, access_token: token });
  const res = await fetch(`${BASE}/${accountId}/adimages`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const images = data.images || {};
  const first = Object.values(images)[0] as { hash: string };
  return first.hash;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const creative = getCreativeById(id);
  if (!creative) return NextResponse.json({ error: "Criativo não encontrado" }, { status: 404 });
  if (creative.status === "published") {
    return NextResponse.json({ error: "Criativo já publicado" }, { status: 400 });
  }

  const { adsetId, adName, publishStatus = "PAUSED" } = await req.json();
  if (!adsetId) return NextResponse.json({ error: "adsetId obrigatório" }, { status: 400 });

  const token = getConfig().metaToken;
  const accountId = creative.adAccountId;

  try {
    // 1. Obter page_id
    const pageId = await getPageId(accountId, token);
    if (!pageId) return NextResponse.json({ error: "Página do Facebook não encontrada na conta" }, { status: 400 });

    // 2. Upload do asset (imagem ou vídeo)
    let objectStorySpec: Record<string, unknown>;
    const cta = creative.copy.cta || "LEARN_MORE";
    const ctaValue = creative.copy.link
      ? { type: cta, value: { link: creative.copy.link } }
      : cta === "WHATSAPP_MESSAGE"
      ? { type: cta, value: { app_destination: "WHATSAPP", link: "https://api.whatsapp.com/send" } }
      : { type: cta };

    if (creative.fileType === "image") {
      const imageHash = await uploadImage(accountId, token, creative.filePath!);
      objectStorySpec = {
        page_id: pageId,
        link_data: {
          image_hash: imageHash,
          link: creative.copy.link || `https://www.facebook.com/${pageId}`,
          message: creative.copy.body,
          name: creative.copy.headline,
          call_to_action: ctaValue,
        },
      };
    } else if (creative.fileType === "video") {
      const videoId = await uploadVideo(accountId, token, creative.filePath!);
      objectStorySpec = {
        page_id: pageId,
        video_data: {
          video_id: videoId,
          message: creative.copy.body,
          title: creative.copy.headline,
          call_to_action: ctaValue,
        },
      };
    } else {
      // URL — tentar como imagem primeiro
      const imageHash = await uploadImageFromUrl(accountId, token, creative.fileUrl!);
      objectStorySpec = {
        page_id: pageId,
        link_data: {
          image_hash: imageHash,
          link: creative.copy.link || creative.fileUrl!,
          message: creative.copy.body,
          name: creative.copy.headline,
          call_to_action: ctaValue,
        },
      };
    }

    // 3. Criar ad creative
    const creativeRes = await fetch(`${BASE}/${accountId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: adName || creative.copy.headline || "Criativo",
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: token,
      }),
    });
    const creativeData = await creativeRes.json();
    if (creativeData.error) throw new Error(creativeData.error.message);
    const metaCreativeId = creativeData.id;

    // 4. Criar anúncio
    const adRes = await fetch(`${BASE}/${adsetId}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: adName || creative.copy.headline || "Anúncio",
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: metaCreativeId }),
        status: publishStatus,
        access_token: token,
      }),
    });
    const adData = await adRes.json();
    if (adData.error) throw new Error(adData.error.message);
    const metaAdId = adData.id;

    // 5. Atualizar criativo
    updateCreative({ ...creative, status: "published", metaAdId, metaCreativeId });

    return NextResponse.json({ ok: true, metaAdId, metaCreativeId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
