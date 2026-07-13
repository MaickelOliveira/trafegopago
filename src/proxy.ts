import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "trafegopago-secret-2026-change-in-prod"
);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("tp_session")?.value;

  // Páginas estáticas públicas (ex: política de privacidade pra revisão do
  // Google/Meta) — acessíveis sempre, sem redirecionar mesmo se já logado.
  if (pathname.startsWith("/privacidade")) {
    return NextResponse.next();
  }

  // Briefing é um formulário voltado pro cliente final — precisa abrir sempre,
  // mesmo que quem clique no link esteja logado no CRM no mesmo navegador
  // (ex: o próprio gestor testando o link antes de enviar). Diferente de /login,
  // não deve redirecionar pra dashboard só por já existir uma sessão ativa.
  const isBriefing = pathname.startsWith("/briefing");
  // Mesmo caso do briefing: link de conexão WhatsApp por QR, pra enviar a quem
  // tem o celular físico — precisa abrir mesmo com sessão ativa no navegador.
  const isConectar = pathname.startsWith("/conectar");
  const isPublic = pathname === "/" || pathname.startsWith("/login") || isBriefing || isConectar;
  const isGestor = pathname.startsWith("/gestor");
  const isCliente = pathname.startsWith("/cliente");

  if (isPublic) {
    if (token && !isBriefing && !isConectar) {
      try {
        const { payload } = await jwtVerify(token, SECRET);
        const role = (payload as { role: string }).role;
        const url = request.nextUrl.clone();
        url.pathname = role === "manager" ? "/gestor" : "/cliente";
        return NextResponse.redirect(url);
      } catch {
        // token inválido, deixa ir pra login
      }
    }
    return NextResponse.next();
  }

  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await jwtVerify(token, SECRET);
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

    return NextResponse.next();
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot|mp4|mp3|pdf)).*)"],
};
