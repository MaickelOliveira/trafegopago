import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createFunnel, updateFunnel, getFunnels } from "@/lib/funnels";
import { upsertLeadByPhone } from "@/lib/leads";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";

const STAGE_COLORS = [
  "#6366F1","#3B82F6","#F59E0B","#F97316","#10B981",
  "#EF4444","#8B5CF6","#06B6D4","#84CC16","#EC4899",
];

interface ColumnMapping {
  name?: string;
  phone: string;
  email?: string;
  stage: string;
  notes?: string;
  value?: string;
}

// POST /api/crm/import
// multipart/form-data: file, clientId, funnelName, mapping (JSON)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const clientId = formData.get("clientId") as string | null;
  const existingFunnelId = (formData.get("existingFunnelId") as string | null) || null;
  const funnelName = (formData.get("funnelName") as string | null) || `Importação Kommo — ${new Date().toLocaleDateString("pt-BR")}`;
  const mappingRaw = formData.get("mapping") as string | null;

  if (!file || !clientId || !mappingRaw) {
    return NextResponse.json({ error: "file, clientId e mapping são obrigatórios" }, { status: 400 });
  }

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(mappingRaw);
  } catch {
    return NextResponse.json({ error: "mapping inválido" }, { status: 400 });
  }

  if (!mapping.phone) {
    return NextResponse.json({ error: "Mapeamento de phone é obrigatório" }, { status: 400 });
  }

  // Parse do arquivo
  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Record<string, string>[];
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  } catch {
    return NextResponse.json({ error: "Erro ao ler o arquivo. Verifique se é .xlsx ou .csv válido." }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Planilha vazia ou sem dados." }, { status: 400 });
  }

  let funnel;
  let stageIdMap: Record<string, string> = {};

  if (existingFunnelId) {
    // Importar para funil existente — todos os leads vão para a primeira coluna
    const found = getFunnels().find(f => f.id === existingFunnelId);
    if (!found) return NextResponse.json({ error: "Funil não encontrado." }, { status: 404 });
    funnel = found;
  } else {
    // Coleta etapas únicas preservando a ordem de aparição
    const stagesOrdered: string[] = [];
    const stageSet = new Set<string>();
    for (const row of rows) {
      const stage = String(row[mapping.stage] ?? "").trim();
      if (stage && !stageSet.has(stage)) {
        stageSet.add(stage);
        stagesOrdered.push(stage);
      }
    }

    if (stagesOrdered.length === 0 && mapping.stage) {
      return NextResponse.json({ error: "Nenhuma etapa encontrada na coluna mapeada." }, { status: 400 });
    }

    // Cria o funil com as etapas do Kommo
    const columns = stagesOrdered.map((label, idx) => ({
      id: randomUUID(),
      label,
      color: STAGE_COLORS[idx % STAGE_COLORS.length],
    }));

    funnel = createFunnel(funnelName, columns.length ? columns : [{ id: randomUUID(), label: "Contato inicial", color: STAGE_COLORS[0] }]);
    updateFunnel(funnel.id, { clientId });

    // Mapeia label da etapa → id da coluna criada
    for (const col of funnel.columns) {
      stageIdMap[col.label] = col.id;
    }
  }

  // Importa cada lead
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    let phone = String(row[mapping.phone] ?? "").replace(/\D/g, "");
    if (!phone || phone.length < 8) {
      skipped++;
      continue;
    }
    // Garante código do país 55 (Brasil) para disparos funcionarem
    if (!phone.startsWith("55")) {
      phone = "55" + phone;
    }

    const stageLabel = mapping.stage ? String(row[mapping.stage] ?? "").trim() : "";
    const statusId = existingFunnelId
      ? funnel.columns[0].id
      : (stageIdMap[stageLabel] ?? funnel.columns[0].id);

    const valueRaw = mapping.value ? String(row[mapping.value] ?? "").replace(/[^\d,\.]/g, "").replace(",", ".") : "";
    const value = valueRaw ? parseFloat(valueRaw) : null;

    try {
      upsertLeadByPhone(clientId, phone, {
        name: mapping.name ? String(row[mapping.name] ?? "").trim() || phone : phone,
        email: mapping.email ? String(row[mapping.email] ?? "").trim() || null : null,
        notes: mapping.notes ? String(row[mapping.notes] ?? "").trim() : "",
        value: isNaN(value as number) ? null : value,
        status: statusId,
        funnelId: funnel.id,
        source: "manual",
      });
      created++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    funnelId: funnel.id,
    funnelName: funnel.name,
    created,
    skipped,
    errors,
    total: rows.length,
  });
}
