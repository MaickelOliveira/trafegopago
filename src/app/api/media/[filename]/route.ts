import { canReadMedia } from "@/lib/media-access";
import type { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { chatFileName } from "@/lib/chat-attachments";

export const dynamic = "force-dynamic";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

const MIME_MAP: Record<string, string> = {
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  mp4: "video/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  if (!await canReadMedia(request)) return new NextResponse("Not found", { status: 404 });
  const { filename } = await params;

  // Sanitização: impede path traversal
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = path.join(MEDIA_DIR, filename);
  if (!existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "ogg";
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";
  const download = contentType === "application/octet-stream" || request.nextUrl.searchParams.get("download") === "1";
  const displayName = chatFileName(request.nextUrl.searchParams.get("name"), filename);
  const disposition = `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(displayName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;

  const buffer = readFileSync(filePath);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": disposition,
      ...(ext === "pdf" || contentType === "application/octet-stream" ? { "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'" } : {}),
    },
  });
}
