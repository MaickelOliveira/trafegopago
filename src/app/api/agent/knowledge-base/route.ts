import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient, type KnowledgeBaseDoc } from "@/lib/clients";

export const dynamic = "force-dynamic";

function getConfigForConn(client: NonNullable<ReturnType<typeof getClientById>>, connId: string | null) {
  if (connId && client.agentConfigs) {
    const found = client.agentConfigs.find((c) => c.whatsappConnectionId === connId);
    if (found) return found;
  }
  return client.agentConfig ?? { enabled: false, followUpEnabled: false, followUps: [] };
}

function upsertConfigForConn(
  client: NonNullable<ReturnType<typeof getClientById>>,
  connId: string | null,
  updated: ReturnType<typeof getConfigForConn>
) {
  if (connId) {
    const existing = client.agentConfigs ?? [];
    const idx = existing.findIndex((c) => c.whatsappConnectionId === connId);
    const newConfigs = [...existing];
    if (idx >= 0) newConfigs[idx] = updated;
    else newConfigs.push({ ...updated, whatsappConnectionId: connId });
    upsertClient({ ...client, agentConfigs: newConfigs });
  } else {
    upsertClient({ ...client, agentConfig: updated });
  }
}

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "pdf") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text ?? "";
  }

  if (ext === "txt" || ext === "md") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Formato não suportado: .${ext}. Use PDF ou TXT.`);
}

// GET — lista documentos da base de conhecimento (sem conteúdo completo)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");
  const cfg = getConfigForConn(client, connId);

  // Retorna metadados sem o content (pode ser muito grande)
  const docs = (cfg.knowledgeBase ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    filename: d.filename,
    chars: d.content?.length ?? 0,
    uploadedAt: d.uploadedAt,
  }));

  return NextResponse.json({ docs });
}

// POST — faz upload e extrai texto de PDF/TXT
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connId = req.nextUrl.searchParams.get("connId");

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Formato inválido — envie multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const docName = (formData.get("name") as string | null)?.trim();

  if (!file) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 400 });

  const MAX_MB = 10;
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Arquivo muito grande (máx ${MAX_MB}MB)` }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  let content: string;
  try {
    content = await extractText(buffer, file.name);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  content = content.trim();
  if (!content) return NextResponse.json({ error: "Nenhum texto extraído do arquivo" }, { status: 400 });

  const doc: KnowledgeBaseDoc = {
    id: randomUUID(),
    name: docName || file.name.replace(/\.[^.]+$/, ""),
    filename: file.name,
    content,
    uploadedAt: Date.now(),
  };

  const cfg = getConfigForConn(client, connId);
  const updatedCfg = {
    ...cfg,
    knowledgeBase: [...(cfg.knowledgeBase ?? []), doc],
  };
  upsertConfigForConn(client, connId, updatedCfg);

  return NextResponse.json({ ok: true, doc: { ...doc, content: undefined, chars: content.length } });
}
