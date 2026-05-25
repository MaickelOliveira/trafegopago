import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

// Endpoint de diagnóstico — retorna a resposta bruta do UazapiGO para /instance/all
// Acesse: /api/whatsapp/manager/debug (apenas gestor autenticado)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getConfig();
  const baseUrl = (process.env.UAZAPI_SERVER || config.uazapiServer || "https://nexopro.uazapi.com").replace(/\/$/, "");

  const globalToken = process.env.UAZAPI_TOKEN || config.uazapiToken || "";
  const adminToken  = process.env.UAZAPI_ADMIN_TOKEN || config.uazapiAdminToken || globalToken;

  const results: Record<string, unknown> = {
    baseUrl,
    globalTokenPreview: globalToken ? globalToken.slice(0, 12) + "..." : "NÃO CONFIGURADO",
    adminTokenPreview:  adminToken  ? adminToken.slice(0, 12)  + "..." : "NÃO CONFIGURADO",
    adminTokenSameAsGlobal: adminToken === globalToken,
  };

  // Testa /instance/all com admin token
  try {
    const res = await fetch(`${baseUrl}/instance/all`, {
      headers: { token: adminToken },
      cache: "no-store",
    });
    const text = await res.text();
    results.instanceAll_status = res.status;
    results.instanceAll_headers = Object.fromEntries(res.headers.entries());
    try { results.instanceAll_body = JSON.parse(text); } catch { results.instanceAll_body_raw = text.slice(0, 2000); }
  } catch (e) {
    results.instanceAll_error = String(e);
  }

  // Testa /instance/status com global token (para ver formato de instância única)
  try {
    const res = await fetch(`${baseUrl}/instance/status`, {
      headers: { token: globalToken },
      cache: "no-store",
    });
    const text = await res.text();
    results.instanceStatus_status = res.status;
    try { results.instanceStatus_body = JSON.parse(text); } catch { results.instanceStatus_body_raw = text.slice(0, 1000); }
  } catch (e) {
    results.instanceStatus_error = String(e);
  }

  return NextResponse.json(results, { status: 200 });
}
