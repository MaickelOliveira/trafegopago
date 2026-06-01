import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { sendMasterNotification } from "@/lib/master-notify";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "change-requests.json");

type ChangeRequest = {
  id: string;
  clientId: string;
  clientName: string;
  message: string;
  createdAt: number;
  read: boolean;
};

function loadRequests(): ChangeRequest[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch { return []; }
}

function saveRequests(reqs: ChangeRequest[]) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(reqs, null, 2));
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ requests: loadRequests() });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = session.clientId!;
  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const { message } = (await req.json()) as { message: string };
  if (!message?.trim()) return NextResponse.json({ error: "Mensagem obrigatória" }, { status: 400 });

  const entry: ChangeRequest = {
    id: randomUUID(),
    clientId,
    clientName: client.name,
    message: message.trim(),
    createdAt: Date.now(),
    read: false,
  };

  const requests = loadRequests();
  requests.unshift(entry);
  saveRequests(requests);

  // Notifica via WhatsApp master
  await sendMasterNotification(
    `🤖 *Solicitação de alteração de IA*\n\n*Cliente:* ${client.name}\n*Pedido:* ${message.trim()}`
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = (await req.json()) as { id: string };
  const requests = loadRequests();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx !== -1) { requests[idx].read = true; saveRequests(requests); }
  return NextResponse.json({ ok: true });
}
