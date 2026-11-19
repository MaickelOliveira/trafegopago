import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById } from "@/lib/clients";
import { sendMasterNotification } from "@/lib/master-notify";
import { readDocument, writeDocument, withDataTransaction } from "@/lib/document-store";
import { randomUUID } from "crypto";

type ChangeRequest = {
  id: string;
  clientId: string;
  clientName: string;
  message: string;
  createdAt: number;
  read: boolean;
};

async function loadRequests(): Promise<ChangeRequest[]> { return readDocument("change-requests.json", []); }

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ requests: await loadRequests() });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = session.clientId!;
  const client = (await getClientById(clientId));
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const { message } = (await req.json()) as { message: string };
  if (typeof message !== "string" || !message.trim() || message.length > 10000) return NextResponse.json({ error: "Mensagem obrigatória" }, { status: 400 });

  const entry: ChangeRequest = {
    id: randomUUID(),
    clientId,
    clientName: client.name,
    message: message.trim(),
    createdAt: Date.now(),
    read: false,
  };

  await withDataTransaction(async () => {
    const requests = await loadRequests();
    requests.unshift(entry);
    await writeDocument("change-requests.json", requests);
  });

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
  await withDataTransaction(async () => {
    const requests = await loadRequests();
    const idx = requests.findIndex(r => r.id === id);
    if (idx !== -1) { requests[idx].read = true; await writeDocument("change-requests.json", requests); }
  });
  return NextResponse.json({ ok: true });
}
