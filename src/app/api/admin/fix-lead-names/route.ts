import { NextResponse } from "next/server";
import { getLeads, updateLead } from "@/lib/leads";
import { sanitizeContactName } from "@/lib/conversations";

// GET /api/admin/fix-lead-names?clientId=nexopro&operatorName=Maickel+Oliveira&operatorPhone=554498841285
// Corrige todos os leads cujo nome está errado:
//   - nome que parece número de telefone → reseta para phone (auto-atualiza no próximo contato)
//   - nome igual ao próprio telefone do lead → reseta para phone
//   - nome que parece o telefone de outro lead (cross-contamination) → reseta para phone
//   - nome igual ao do operador em leads que NÃO são do operador → reseta para phone
// Após a correção, os leads ficam com name=phone e o próximo contato via WhatsApp
// atualiza o nome corretamente pelo pushName.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  // Nome do operador que foi incorretamente aplicado a leads de terceiros
  const operatorName = searchParams.get("operatorName")?.trim().toLowerCase();
  // Telefone real do operador (normalizado, só dígitos) — leads com este telefone são mantidos
  const operatorPhone = searchParams.get("operatorPhone")?.replace(/\D/g, "");

  const allLeads = getLeads(clientId ?? undefined);

  // Constrói um Set com todos os telefones normalizados do conjunto
  // para detectar nomes que são telefones de OUTROS leads (cross-contamination)
  const allPhones = new Set(allLeads.map((l) => l.phone.replace(/\D/g, "")));

  const fixed: Array<{ id: string; name: string; oldName: string; phone: string; reason: string }> = [];

  for (const lead of allLeads) {
    const name = lead.name;
    const phone = lead.phone;
    const phoneNorm = phone.replace(/\D/g, "");

    // Motivo 1: nome é idêntico ao próprio telefone
    if (name === phone || name.replace(/\D/g, "") === phoneNorm) {
      updateLead(lead.id, { name: phoneNorm });
      fixed.push({ id: lead.id, name: phoneNorm, oldName: name, phone, reason: "nome era o próprio número" });
      continue;
    }

    // Motivo 2: sanitizeContactName rejeita o nome (parece número de telefone, vazio, muito longo)
    if (sanitizeContactName(name, phone) === undefined) {
      updateLead(lead.id, { name: phoneNorm });
      fixed.push({ id: lead.id, name: phoneNorm, oldName: name, phone, reason: "nome parece número de telefone ou inválido" });
      continue;
    }

    // Motivo 3: nome é igual ao número de OUTRO lead (cross-contamination)
    const nameDigits = name.replace(/\D/g, "");
    if (nameDigits.length >= 8 && allPhones.has(nameDigits)) {
      updateLead(lead.id, { name: phoneNorm });
      fixed.push({ id: lead.id, name: phoneNorm, oldName: name, phone, reason: "nome era telefone de outro lead (cross-contamination)" });
      continue;
    }

    // Motivo 4: nome é do operador mas o lead não é o operador
    // (acontece quando o operador envia a primeira mensagem para o lead via WPPConnect)
    if (
      operatorName &&
      name.trim().toLowerCase() === operatorName &&
      operatorPhone &&
      phoneNorm !== operatorPhone
    ) {
      updateLead(lead.id, { name: phoneNorm });
      fixed.push({ id: lead.id, name: phoneNorm, oldName: name, phone, reason: "nome era do operador (contaminação por fromMe)" });
      continue;
    }
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
