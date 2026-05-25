import { readFileSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import { NextResponse } from "next/server";

const UPLOADS_DIR = join(process.cwd(), "data", "uploads");

const CONTENT_TYPES: Record<string, string> = {
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Segurança: bloqueia path traversal
  const safe = basename(filename);
  if (safe !== filename || filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Inválido" }, { status: 400 });
  }

  const filepath = join(UPLOADS_DIR, safe);
  if (!existsSync(filepath)) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const ext = extname(safe).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const file = readFileSync(filepath);

  return new NextResponse(file, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
