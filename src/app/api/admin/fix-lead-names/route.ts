import { NextResponse } from "next/server";
import { getLeads, updateLead } from "@/lib/leads";
import { sanitizeContactName } from "@/lib/conversations";

// GET /api/admin/fix-lead-names?clientId=nexopro
// Corrige todos os leads cujo nome está errado:
//   - nome que parece número de telefone → reseta para "Desconhecido"
//   - nome igual ao próprio telefone do lead → reseta para "Desconhecido"
//   - nome que parece o telefone de outro lead (cross-contamination) → reseta para "Desconhecido"
// Após a correção, os leads ficam como "Desconhecido" e o próximo contato do cliente
// via WhatsApp atualiza o nome corretamente pelo pushName.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");

  const allLeads = getLeads(clientId ?? undefined);

  // Constrói um Set com todos os telefones normalizados do conjunto
  // para detectar nomes que são telefones de OUTROS leads (cross-contamination)
  const allPhones = new Set(allLeads.map((l) => l.phone.replace(/\D/g, "")));

  const fixed: Array<{ id: string; name: string; oldName: string; phone: string; reason: string }> = [];
  const skipped: number[] = [];

  for (const lead of allLeads) {
    const name = lead.name;
    const phone = lead.phone;

    // Motivo 1: nome é idêntico ao próprio telefone
    if (name === phone || name.replace(/\D/g, "") === phone.replace(/\D/g, "")) {
      updateLead(lead.id, { name: "Desconhecido" });
      fixed.push({ id: lead.id, name: "Desconhecido", oldName: name, phone, reason: "nome era o próprio número" });
      continue;
    }

    // Motivo 2: sanitizeContactName rejeita o nome (parece número de telefone, vazio, muito longo)
    if (sanitizeContactName(name, phone) === undefined) {
      updateLead(lead.id, { name: "Desconhecido" });
      fixed.push({ id: lead.id, name: "Desconhecido", oldName: name, phone, reason: "nome parece número de telefone ou inválido" });
      continue;
    }

    // Motivo 3: nome é igual ao número de OUTRO lead (cross-contamination)
    const nameDigits = name.replace(/\D/g, "");
    if (nameDigits.length >= 8 && allPhones.has(nameDigits)) {
      updateLead(lead.id, { name: "Desconhecido" });
      fixed.push({ id: lead.id, name: "Desconhecido", oldName: name, phone, reason: "nome era telefone de outro lead (cross-contamination)" });
      continue;
    }

    skipped.push(0); // lead com nome válido
  }

  const total = allLeads.length;
  const fixedCount = fixed.length;
  const okCount = total - fixedCount;

  return NextResponse.json({
    message: `Correção concluída. ${fixedCount} lead(s) corrigido(s), ${okCount} OK.`,
    total,
    fixed: fixedCount,
    ok: okCount,
    details: fixed,
  });
}
