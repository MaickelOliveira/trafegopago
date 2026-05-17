import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";
import { upsertLeadByPhone } from "@/lib/leads";

type UazContact = {
  contact_FirstName?: string;
  contact_name?: string;
  jid: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId  = (body.clientId  as string) || "sem-cliente";
  const funnelId  = (body.funnelId  as string) || "default";

  const config = getConfig();
  const server = config.uazapiServer;
  const token  = config.uazapiToken;

  if (!server || !token) {
    return NextResponse.json({ error: "WhatsApp não configurado" }, { status: 400 });
  }

  const res = await fetch(`${server}/contacts`, {
    headers: { token },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Erro ao buscar contatos" }, { status: 502 });
  }

  const contacts: UazContact[] = await res.json();

  // Filtra grupos e números não-humanos
  const leads = contacts.filter((c) => {
    if (!c.jid.includes("@s.whatsapp.net")) return false; // ignora grupos
    const phone = c.jid.replace("@s.whatsapp.net", "");
    if (phone.length < 10 || phone.length > 15) return false;
    return true;
  });

  let created = 0;
  let skipped = 0;

  for (const contact of leads) {
    const phone = contact.jid.replace("@s.whatsapp.net", "");
    const name  = contact.contact_name || contact.contact_FirstName || phone;

    try {
      upsertLeadByPhone(clientId, phone, {
        clientId,
        funnelId,
        name,
        source: "whatsapp",
        status: "novo",
      });
      created++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ created, skipped, total: leads.length });
}
