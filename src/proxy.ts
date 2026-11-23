import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { authorizeApi } from "./lib/api-access";

// Lazy — evita quebrar `next build` (que pode importar/avaliar este módulo
// sem env vars de runtime disponíveis) e evita derrubar o processo inteiro na
// inicialização caso a env var falte momentaneamente. A checagem real só
// acontece quando uma requisição de fato precisa verificar um token.
function getSecret(): Uint8Array {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET não está configurado — defina essa variável de ambiente antes de iniciar o servidor.");
  }
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

function continueRequest(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob: data: https:",
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    try {
      const refusal = await authorizeApi(request);
      return refusal ?? NextResponse.next();
    } catch {
      return NextResponse.json({ error: "Serviço temporariamente indisponível." }, { status: 503 });
    }
  }
  const token = request.cookies.get("tp_session")?.value;

  // Páginas estáticas públicas (ex: política de privacidade pra revisão do
  // Google/Meta, página de download da extensão pra mandar link a qualquer
  // pessoa) — acessíveis sempre, sem redirecionar mesmo se já logado.
  if (pathname.startsWith("/privacidade") || pathname.startsWith("/extensao-download")) {
    return continueRequest(request);
  }

  // Briefing é um formulário voltado pro cliente final — precisa abrir sempre,
  // mesmo que quem clique no link esteja logado no CRM no mesmo navegador
  // (ex: o próprio gestor testando o link antes de enviar). Diferente de /login,
  // não deve redirecionar pra dashboard só por já existir uma sessão ativa.
  const isBriefing = pathname.startsWith("/briefing");
  // Mesmo caso do briefing: link de conexão WhatsApp por QR, pra enviar a quem
  // tem o celular físico — precisa abrir mesmo com sessão ativa no navegador.
  const isConectar = pathname.startsWith("/conectar") || pathname.startsWith("/conectar-evolution");
  // Ficha de hóspedes: link mandado pelo WhatsApp pro cliente final preencher —
  // nunca tem sessão logada (é o hóspede da pousada, não um usuário da
  // plataforma). Sem isso, caía no redirect padrão pra /login.
  const isGuestForm = pathname.startsWith("/formulario-hospede");
  // Mesmo caso do formulário de hóspedes, mas pra participantes de outros
  // serviços da pousada (Day Use, Almoço, etc.) — ver src/lib/servico-forms.ts.
  const isServicoForm = pathname.startsWith("/formulario-servico");
  const isPublic = pathname === "/" || pathname.startsWith("/login") || isBriefing || isConectar || isGuestForm || isServicoForm;
  const isGestor = pathname.startsWith("/gestor");
  const isCliente = pathname.startsWith("/cliente");

  if (isPublic) {
    if (token && !isBriefing && !isConectar && !isGuestForm && !isServicoForm) {
      try {
        const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
        const role = (payload as { role: string }).role;
        const url = request.nextUrl.clone();
        url.pathname = role === "manager" ? "/gestor" : "/cliente";
        return NextResponse.redirect(url);
      } catch {
        // token inválido, deixa ir pra login
      }
    }
    return continueRequest(request);
  }

  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    const role = (payload as { role: string }).role;

    if (isGestor && role !== "manager") {
      const url = request.nextUrl.clone();
      url.pathname = "/cliente";
      return NextResponse.redirect(url);
    }

    if (isCliente && role !== "client" && role !== "employee") {
      const url = request.nextUrl.clone();
      url.pathname = "/gestor";
      return NextResponse.redirect(url);
    }

    return continueRequest(request);
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/api/:path*", "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot|mp4|mp3|pdf|zip)).*)"],
};
