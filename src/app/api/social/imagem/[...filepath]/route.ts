import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readFileSync, existsSync } from "fs";
import path from "path";

const CLIENTES_DIR = path.join(process.cwd(), "..", "clientes");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filepath: string[] }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { filepath } = await params;
  const filePath = path.join(CLIENTES_DIR, ...filepath);

  // Segurança: garante que o caminho está dentro de clientes/
  if (!filePath.startsWith(CLIENTES_DIR)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (!existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp",
  };

  const buffer = readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: { "Content-Type": mime[ext] ?? "image/png" },
  });
}
