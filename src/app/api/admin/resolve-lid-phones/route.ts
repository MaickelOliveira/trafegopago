import { NextResponse } from "next/server";
import { getLeads, updateLead } from "@/lib/leads";
import { getWppSessions } from "@/lib/wppconnect-sessions";
import { resolveContactPhone } from "@/lib/wppconnect-api";

// GET /api/admin/resolve-lid-phones?clientId=nexopro
// Resolve o número real de TODOS os leads LID que ainda não têm realPhone
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");

  // Pega todos os leads LID sem realPhone
  const allLeads = getLeads(clientId ?? undefined);
  const lidLeads = allLeads.filter((l) => l.isLid && !l.realPhone);

  if (lidLeads.length === 0) {
    return NextResponse.json({ message: "Nenhum lead LID sem realPhone encontrado.", resolved: 0 });
  }

  // Pega todas as sessões WPPConnect para fazer o lookup
  const sessions = getWppSessions();

  const results: Array<{ phone: string; realPhone: string | null; status: string }> = [];

  for (const lead of lidLeads) {
    // Encontra a sessão correspondente ao clientId do lead
    const session = sessions.find(
      (s) => s.clientId === lead.clientId || s.funnelId === lead.funnelId
    );

    if (!session) {
      results.push({ phone: lead.phone, realPhone: null, status: "sem sessão WPPConnect" });
      continue;
    }

    try {
      const lidJid = `${lead.phone}@lid`;
      const realPhone = await resolveContactPhone(
        session.sessionName,
        session.sessionToken,
        lidJid
      );

      if (realPhone && realPhone !== lead.phone) {
        updateLead(lead.id, { realPhone });
        results.push({ phone: lead.phone, realPhone, status: "resolvido" });
        console.log(`[resolve-lid-phones] ${lead.phone} → ${realPhone}`);
      } else {
        results.push({ phone: lead.phone, realPhone: null, status: "não resolvido pelo WPPConnect" });
      }
    } catch (e) {
      results.push({ phone: lead.phone, realPhone: null, status: `erro: ${e}` });
    }
  }

  const resolvedCount = results.filter((r) => r.realPhone).length;

  return NextResponse.json({
    message: `${resolvedCount} de ${lidLeads.length} leads LID resolvidos.`,
    resolved: resolvedCount,
    total: lidLeads.length,
    results,
  });
}
