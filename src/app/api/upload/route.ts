import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { NextRequest, NextResponse } from "next/server";

const UPLOADS_DIR = join(process.cwd(), "data", "uploads");

const ALLOWED_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MAX_SIZE_MB = 25;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_TYPES[ext]) {
      return NextResponse.json({ error: "Tipo de arquivo não permitido" }, { status: 400 });
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json({ error: `Arquivo muito grande (máx ${MAX_SIZE_MB}MB)` }, { status: 400 });
    }

    if (!existsSync(UPLOADS_DIR)) {
      mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    writeFileSync(join(UPLOADS_DIR, filename), buffer);

    const host = request.headers.get("host") ?? "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const url = `${protocol}://${host}/api/uploads/${filename}`;

    return NextResponse.json({ url, filename, originalName: file.name });
  } catch (err) {
    console.error("[upload] Erro:", err);
    return NextResponse.json({ error: "Erro interno ao salvar arquivo" }, { status: 500 });
  }
}
