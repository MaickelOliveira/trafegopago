import { normalizeRecordedAudio } from "@/lib/audio-upload";
import { getFunnelForConnection } from "@/lib/lead-context";
import { matchesUploadType } from "@/lib/upload-signature";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { registerMediaFile, signMediaUrl } from "@/lib/media-access";
import { randomUUID } from "node:crypto";
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
  ".webm":"audio/webm",
  ".ogg":"audio/ogg",
  ".mp3":"audio/mpeg",
  ".m4a":"audio/mp4",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MAX_SIZE_MB = 25;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    let ext = extname(file.name).toLowerCase();
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
    let buffer:Buffer = Buffer.from(bytes);
    if (!matchesUploadType(ext, buffer)) return NextResponse.json({ error: "O conteúdo não corresponde ao tipo do arquivo." }, { status: 400 });
    if(ext===".webm"){buffer=await normalizeRecordedAudio(buffer);ext=".ogg";}
    const owner = session.role === "manager" ? String(formData.get("clientId") || "") || null : session.clientId!;
    const connId=String(formData.get("connId")||"")||undefined;
    if(session.role==="employee"&&!connId)return NextResponse.json({error:"Selecione a conversa antes de anexar."},{status:422});
    if(connId&&(!owner||!await getFunnelForConnection(owner,connId)))return NextResponse.json({error:"Conexão inválida."},{status:403});
    if(session.role==="employee"){const {getEmployeeById,employeeCanAccessFunnel}=await import("@/lib/employees");const employee=await getEmployeeById(session.employeeId!);const funnel=await getFunnelForConnection(owner!,connId!);if(!employee||!funnel||!employeeCanAccessFunnel(employee,funnel.id))return NextResponse.json({error:"Acesso não permitido."},{status:403});}
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(join(UPLOADS_DIR, filename), buffer);

    await registerMediaFile(`/api/uploads/${filename}`, owner,connId);
    const base = process.env.APP_BASE_URL || (await getConfig()).appBaseUrl || request.nextUrl.origin;
    const url = await signMediaUrl(new URL(`/api/uploads/${filename}`, base).toString());

    return NextResponse.json({ url, filename, originalName: file.name });
  } catch (err) {
    console.error("[upload] Erro:", err);
    return NextResponse.json({ error: "Erro interno ao salvar arquivo" }, { status: 500 });
  }
}
