import { NextRequest, NextResponse } from "next/server";
import { recordClick } from "@/lib/wa-clicks";

export const dynamic = "force-dynamic";

/**
 * GET /api/wa-redirect
 * Parâmetros esperados:
 *   phone      — número de WhatsApp do destino (DDI+DDD+número)
 *   msg        — mensagem pré-pronta (SEM UTMs)
 *   clientId   — ID do cliente na plataforma
 *   src        — utm_source
 *   cmp        — utm_campaign
 *   med        — utm_medium
 *   cnt        — utm_content
 *   trm        — utm_term
 *   fbc        — fbclid
 *   gcd        — gclid
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const phone    = p.get("phone")?.replace(/\D/g, "") ?? "";
  const msg      = p.get("msg") ?? "";
  const clientId = p.get("clientId") ?? "sem-cliente";

  if (!phone) {
    return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
  }

  // Salva o clique com os UTMs
  recordClick({
    clientId,
    utmSource:   p.get("src")  || null,
    utmCampaign: p.get("cmp")  || null,
    utmMedium:   p.get("med")  || null,
    utmContent:  p.get("cnt")  || null,
    utmTerm:     p.get("trm")  || null,
    fbclid:      p.get("fbc")  || null,
    gclid:       p.get("gcd")  || null,
  });

  // Redireciona para wa.me com mensagem limpa (sem UTMs)
  const waUrl = `https://wa.me/${phone}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
  return NextResponse.redirect(waUrl, 302);
}
