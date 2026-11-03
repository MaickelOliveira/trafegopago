import { verifyAdAssetAccess } from "@/lib/ad-media-access";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

type Params = { params: Promise<{ mediaId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  const { mediaId } = await params;
  if(session.role!=="manager" && !verifyAdAssetAccess(_req.nextUrl,"ig",mediaId,session.clientId!)) return NextResponse.json({error:"Acesso não permitido."},{status:403});
  const token = (await getConfig()).metaToken;

  const res = await fetch(
    `https://graph.facebook.com/v26.0/${mediaId}?fields=media_type,media_url,thumbnail_url`,
    { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 86400 } }
  );
  const data = await res.json();
  if (data.error) return NextResponse.json({ url: null });

  // Vídeos: usar thumbnail_url (imagem estática)
  // Imagens/carrosséis: usar media_url (a foto)
  const url = data.media_type === "VIDEO"
    ? (data.thumbnail_url || null)
    : (data.media_url || data.thumbnail_url || null);

  return NextResponse.json({ url });
}
