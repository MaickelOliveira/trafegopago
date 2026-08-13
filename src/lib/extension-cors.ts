import { NextResponse } from "next/server";

/** As únicas rotas chamadas DIRETO do content-script.ts da extensão (não do
 *  service worker): GET/POST em /pending-replies. fetch() de dentro de um
 *  content script continua sujeito ao CORS normal do navegador contra o
 *  servidor de destino — diferente de fetch() no service worker, que roda
 *  em contexto privilegiado da extensão e é isento disso. Sem esses
 *  headers, o preflight OPTIONS falha e a extensão nunca recebe a resposta
 *  pendente da IA (confirmado ao vivo: erro de CORS no console do
 *  DevTools). Origem travada no domínio exato do WhatsApp Web — não é um
 *  endpoint público, a autenticação real continua sendo o Bearer token do
 *  dispositivo, isso só libera o navegador a deixar a resposta chegar. */
const ALLOWED_ORIGIN = "https://web.whatsapp.com";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function corsJson(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, { status: init?.status, headers: corsHeaders() });
}

export function corsOptionsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
