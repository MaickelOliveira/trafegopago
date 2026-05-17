import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { saveCreative, getCreativesByClient } from "@/lib/creatives";
import type { Creative, FileType } from "@/lib/creatives";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  let clientId: string;

  if (session.role === "manager") {
    clientId = searchParams.get("clientId") || "";
    if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });
  } else {
    clientId = session.clientId!;
  }

  const items = getCreativesByClient(clientId);
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  let clientId: string;
  let adAccountId: string;

  const formData = await req.formData();
  const copyRaw = formData.get("copy") as string;
  const copy = JSON.parse(copyRaw || "{}");
  const urlField = formData.get("url") as string | null;

  if (session.role === "manager") {
    clientId = formData.get("clientId") as string;
    adAccountId = formData.get("adAccountId") as string;
    if (!clientId || !adAccountId) {
      return NextResponse.json({ error: "clientId e adAccountId obrigatórios" }, { status: 400 });
    }
  } else {
    clientId = session.clientId!;
    const client = getClientById(clientId);
    adAccountId = client?.adAccounts[0]?.id || "";
  }

  let filePath: string | null = null;
  let fileUrl: string | null = null;
  let fileType: FileType = "url";

  if (urlField) {
    fileUrl = urlField;
    fileType = "url";
  } else {
    const file = formData.get("file") as File | null;
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const isVideo = ["mp4", "mov", "avi"].includes(ext);
      fileType = isVideo ? "video" : "image";
      const filename = `${randomUUID()}.${ext}`;
      const dir = path.join(process.cwd(), "public", "uploads", "creatives");
      mkdirSync(dir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(path.join(dir, filename), buffer);
      filePath = `/uploads/creatives/${filename}`;
    }
  }

  if (!filePath && !fileUrl) {
    return NextResponse.json({ error: "Envie um arquivo ou URL" }, { status: 400 });
  }

  const creative: Creative = {
    id: `crtv_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    clientId,
    adAccountId,
    sentBy: session.role === "manager" ? "manager" : "client",
    status: "pending",
    fileType,
    filePath,
    fileUrl,
    copy: {
      headline: copy.headline || "",
      body: copy.body || "",
      cta: copy.cta || "LEARN_MORE",
      link: copy.link || null,
    },
    metaAdId: null,
    metaCreativeId: null,
    rejectionComment: null,
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveCreative(creative);
  return NextResponse.json(creative, { status: 201 });
}
