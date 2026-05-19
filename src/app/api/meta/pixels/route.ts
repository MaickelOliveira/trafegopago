import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

type RawPixel = { id: string; name: string };
type RawBusiness = { id: string; name: string };

async function fetchPixels(url: string): Promise<RawPixel[]> {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error || !data.data) return [];
  return data.data as RawPixel[];
}

// GET /api/meta/pixels?adAccountId=act_xxx
// Busca pixels acessíveis: diretos do usuário, via BMs, e via conta de anúncio específica
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { metaToken: token } = getConfig();
  if (!token) return NextResponse.json({ error: "Token Meta não configurado" }, { status: 400 });

  const adAccountId = req.nextUrl.searchParams.get("adAccountId");
  const base = "https://graph.facebook.com/v19.0";
  const fields = `fields=id,name&limit=200&access_token=${token}`;

  const all: RawPixel[] = [];

  // 1. Pixels vinculados à conta de anúncio (se fornecida)
  if (adAccountId) {
    const pixels = await fetchPixels(`${base}/${adAccountId}/adspixels?${fields}`);
    all.push(...pixels);
  }

  // 2. Pixels diretos do usuário
  const direct = await fetchPixels(`${base}/me/adspixels?${fields}`);
  all.push(...direct);

  // 3. Pixels via Business Managers
  const bizRes = await fetch(`${base}/me/businesses?fields=id,name&limit=50&access_token=${token}`);
  const bizData = await bizRes.json();
  const businesses: RawBusiness[] = bizData.data ?? [];

  const bmPixels = await Promise.all(
    businesses.map((biz) => fetchPixels(`${base}/${biz.id}/adspixels?${fields}`))
  );
  bmPixels.flat().forEach((p) => all.push(p));

  // Remove duplicatas por ID
  const seen = new Set<string>();
  const unique = all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return NextResponse.json(unique);
}
