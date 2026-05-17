import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

// Posta no Instagram via Meta Graph API (requer Instagram Business + Facebook Page)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { imageUrl, legenda, pageId, instagramAccountId } = await req.json();

  if (!imageUrl || !legenda || !instagramAccountId) {
    return NextResponse.json({ error: "imageUrl, legenda e instagramAccountId são obrigatórios" }, { status: 400 });
  }

  const config = getConfig();
  const token = config.metaToken;

  try {
    // 1. Cria container de mídia no Instagram
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: legenda,
          access_token: token,
        }),
      }
    );

    const container = await containerRes.json();
    if (!container.id) {
      return NextResponse.json({ error: "Erro ao criar container", detail: container }, { status: 500 });
    }

    // 2. Publica o container
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: container.id,
          access_token: token,
        }),
      }
    );

    const published = await publishRes.json();
    if (!published.id) {
      return NextResponse.json({ error: "Erro ao publicar", detail: published }, { status: 500 });
    }

    return NextResponse.json({ ok: true, postId: published.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
