import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "trafegopago-secret-2026-change-in-prod"
);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("tp_session")?.value;

  const isPublic = pathname === "/" || pathname.startsWith("/login");
  const isGestor = pathname.startsWith("/gestor");
  const isCliente = pathname.startsWith("/cliente");

  if (isPublic) {
    if (token) {
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

    if (isCliente && role !== "client") {
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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
