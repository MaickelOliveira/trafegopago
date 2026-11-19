import { verifyAdAssetAccess } from "@/lib/ad-media-access";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

type Params = { params: Promise<{ videoId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  const { videoId } = await params;
  if(session.role!=="manager" && !verifyAdAssetAccess(_req.nextUrl,"video",videoId,session.clientId!)) return NextResponse.json({error:"Acesso não permitido."},{status:403});
  const token = (await getConfig()).metaToken;

  const res = await fetch(
    `https://graph.facebook.com/v26.0/${videoId}?fields=source,embed_html,thumbnails`,
    { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 3600 } }
  );
  const data = await res.json();

  if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });
  return NextResponse.json({ source: data.source || null, embedHtml: data.embed_html || null });
}
