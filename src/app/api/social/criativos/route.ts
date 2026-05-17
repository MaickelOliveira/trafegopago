import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readdirSync, existsSync } from "fs";
import path from "path";

const CLIENTES_DIR = path.join(process.cwd(), "..", "clientes");

// Descobre o nome da pasta do cliente (ex: "nexo-pro" → "nexo")
function resolveClienteDir(clientId: string): string | null {
  // Tenta exato
  const exact = path.join(CLIENTES_DIR, clientId);
  if (existsSync(exact)) return exact;
  // Tenta nome curto (nexo-pro → nexo)
  const short = clientId.split("-")[0];
  const byShort = path.join(CLIENTES_DIR, short);
  if (existsSync(byShort)) return byShort;
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  if (!clientId) return NextResponse.json([]);

  const clienteDir = resolveClienteDir(clientId);
  if (!clienteDir) return NextResponse.json([]);

  const criativosDir = path.join(clienteDir, "criativos");
  if (!existsSync(criativosDir)) return NextResponse.json([]);

  const folderName = path.basename(clienteDir);
  const files = readdirSync(criativosDir)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map((f) => ({
      nome: f.replace(/\.(png|jpg|jpeg|webp)$/i, "").replace(/-/g, " "),
      url: `/api/social/imagem/${folderName}/criativos/${f}`,
      arquivo: f,
    }));

  return NextResponse.json(files);
}
