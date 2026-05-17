import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client" || !session.clientId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const client = getClientById(session.clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const { whatsappPhone, automations } = await req.json();

  // Client can only update whatsappPhone and clientEnabled flags on non-managerOnly automations
  const safeAutomations = { ...client.automations };
  if (automations) {
    const { AUTOMATIONS } = await import("@/lib/automations");
    for (const { key, managerOnly } of AUTOMATIONS) {
      if (!managerOnly && automations[key] !== undefined) {
        safeAutomations[key] = {
          ...(safeAutomations[key] ?? { enabled: false }),
          clientEnabled: automations[key]?.clientEnabled,
        };
      }
    }
  }

  upsertClient({
    ...client,
    whatsappPhone: whatsappPhone ?? client.whatsappPhone,
    automations: safeAutomations,
  });

  return NextResponse.json({ ok: true });
}
