import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import path from "path";
import type { Lead } from "@/lib/leads";

const FILE = path.join(process.cwd(), "data", "leads.json");
const BAK  = FILE + ".bak-before-dedup";
const TMP  = FILE + ".tmp";

/** Mesma lógica de normalizePhone em leads.ts — copiada aqui para não depender de módulo com side-effects */
function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /^[1-9]{2}[6-9]/.test(d)) {
    d = d.slice(0, 2) + "9" + d.slice(2);
  }
  return d;
}

// GET /api/admin/dedup-leads?clientId=nexopro   ← filtra por cliente (opcional)
// GET /api/admin/dedup-leads?dry=1              ← apenas simula, não salva
//
// O que faz:
// 1. Normaliza o campo `phone` de todos os leads (remove prefixo 55, adiciona 9º dígito se BR)
// 2. Agrupa leads com mesmo clientId + telefone normalizado → mantém o mais antigo e descarta os demais
//    (campos não-nulos dos descartados são herdados pelo lead principal se o principal tiver nulo)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filterClient = searchParams.get("clientId");
  const dry = searchParams.get("dry") === "1";

  if (!existsSync(FILE)) {
    return NextResponse.json({ message: "leads.json não encontrado.", fixed: 0, merged: 0 });
  }

  const leads: Lead[] = JSON.parse(readFileSync(FILE, "utf-8"));

  const phonesFixed: string[] = [];
  const mergeLog: Array<{ kept: string; removed: string; phone: string; clientId: string }> = [];

  // ── Passo 1: normaliza todos os telefones ──────────────────────────────────
  for (const lead of leads) {
    if (!filterClient || lead.clientId === filterClient) {
      const norm = normalizePhone(lead.phone);
      if (norm !== lead.phone) {
        phonesFixed.push(`${lead.phone} → ${norm} (id=${lead.id})`);
        if (!dry) lead.phone = norm;
      }
    }
  }

  // ── Passo 2: agrupa por clientId + normalizedPhone e mescla duplicatas ─────
  // Usa Map para agrupar: chave = clientId:normalizedPhone
  // Agrupa por clientId + funnelId + telefone normalizado — mesmo telefone em
  // funis diferentes é um lead separado por design (cada agente/canal tem o
  // seu), então funnelId precisa entrar na chave pra não mesclar leads que na
  // verdade são distintos.
  const groups = new Map<string, Lead[]>();

  for (const lead of leads) {
    const key = `${lead.clientId}:${lead.funnelId}:${normalizePhone(lead.phone)}`;
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }

  const result: Lead[] = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Ordena por createdAt: mantém o mais antigo como lead principal
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const [primary, ...duplicates] = group;

    // Herda campos não-nulos dos duplicatas para o lead principal
    for (const dup of duplicates) {
      for (const key of Object.keys(dup) as (keyof Lead)[]) {
        const primaryVal = primary[key];
        const dupVal = dup[key];
        // Herda apenas campos nulos/padrão do principal que o duplicata tem preenchido
        if (
          dupVal !== null &&
          dupVal !== undefined &&
          dupVal !== "" &&
          dupVal !== "Desconhecido" &&
          (primaryVal === null || primaryVal === undefined || primaryVal === "" || primaryVal === "Desconhecido")
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (primary as any)[key] = dupVal;
        }
      }
      // Mantém o nome do principal (mais antigo) a menos que seja "Desconhecido"
      if (primary.name === "Desconhecido" && dup.name && dup.name !== "Desconhecido") {
        primary.name = dup.name;
      }
      primary.updatedAt = new Date().toISOString();

      mergeLog.push({
        kept: primary.id,
        removed: dup.id,
        phone: primary.phone,
        clientId: primary.clientId,
      });
    }

    result.push(primary);
  }

  if (!dry) {
    // Backup antes de salvar
    writeFileSync(BAK, readFileSync(FILE));
    writeFileSync(TMP, JSON.stringify(result, null, 2));
    renameSync(TMP, FILE);
  }

  return NextResponse.json({
    message: dry
      ? `[DRY RUN] ${phonesFixed.length} telefone(s) seriam normalizados, ${mergeLog.length} lead(s) seriam mesclados.`
      : `${phonesFixed.length} telefone(s) normalizado(s), ${mergeLog.length} lead(s) duplicado(s) removido(s).`,
    dry,
    phonesNormalized: phonesFixed.length,
    leadsMerged: mergeLog.length,
    totalBefore: leads.length,
    totalAfter: result.length,
    phoneDetails: phonesFixed,
    mergeDetails: mergeLog,
  });
}
