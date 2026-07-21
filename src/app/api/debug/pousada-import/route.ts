import { NextRequest, NextResponse } from "next/server";
import { getClientById, upsertClient, getAllAgentConfigs } from "@/lib/clients";
import { getSheetHeadersCached, getAllRows } from "@/lib/google-sheets";
import { getReservas, createReserva } from "@/lib/pousada";
import type { PousadaTipo, Pessoa } from "@/lib/pousada-types";

export const dynamic = "force-dynamic";

// Migração única: lê as planilhas Google Sheets já configuradas pro cliente
// (uma aba por sheetMapping) e importa as reservas existentes pro novo
// sistema interno da Pousada. Best-effort — a coluna "Pessoas" da planilha é
// texto livre, então nome/idade/valor são recuperados por regex; CPF/RG/
// endereço não existiam estruturados na planilha antiga, então ficam vazios
// (o hóspede que enviar dados de novo pela IA já vai gravar completo).
// Rodar uma vez, manualmente, via curl — não é uma rota de uso contínuo.

function parseDateToIso(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return undefined;
}

function parseMoneyBR(raw: string | undefined): number {
  if (!raw) return 0;
  const num = parseFloat(raw.replace(/R\$\s?/gi, "").replace(/\./g, "").replace(",", ".").trim());
  return isNaN(num) ? 0 : num;
}

// Extrai pessoas do texto livre "Nome (XX anos) - R$XX,00, Nome2 (XX anos) - Gratuito"
function parsePessoasTexto(texto: string | undefined): Pessoa[] {
  if (!texto) return [];
  const out: Pessoa[] = [];
  const re = /([^,()]+?)\s*\((\d{1,2})\s*anos?\)\s*-?\s*(Gratuito|R\$\s*[\d.,]+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const nome = m[1].trim();
    if (!nome) continue;
    const idade = parseInt(m[2], 10);
    const valorRaw = m[3];
    const gratuito = /gratuito/i.test(valorRaw ?? "");
    out.push({ nome, idade: isNaN(idade) ? undefined : idade, valor: gratuito ? 0 : parseMoneyBR(valorRaw), gratuito });
  }
  return out;
}

function findCol(headers: string[], regex: RegExp): string | undefined {
  return headers.find((h) => regex.test(h));
}

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const agentConfigs = getAllAgentConfigs(client);
  const existentes = getReservas(clientId);
  const results: Record<string, unknown>[] = [];

  // Une todos os sheetMappings de todas as conexões num único conjunto de tipos
  const tiposUniao = new Map<string, PousadaTipo>();
  for (const t of client.pousadaTipos ?? []) tiposUniao.set(t.slug, t);
  for (const cfg of agentConfigs) {
    for (const m of cfg.sheetMappings ?? []) tiposUniao.set(m.tipo, { slug: m.tipo, label: m.label });
  }

  for (const cfg of agentConfigs) {
    if (!cfg.googleRefreshToken || !cfg.spreadsheetId || !cfg.sheetMappings?.length) continue;

    for (const mapping of cfg.sheetMappings) {
      try {
        const headers = await getSheetHeadersCached(cfg.googleRefreshToken, cfg.spreadsheetId, mapping.tabName);
        if (!headers.length) {
          results.push({ aba: mapping.tabName, skipped: "sem cabeçalho" });
          continue;
        }
        const rows = await getAllRows(cfg.googleRefreshToken, cfg.spreadsheetId, mapping.tabName, headers);

        const hResponsavel = findCol(headers, /respons[aá]vel/i);
        const hData = findCol(headers, /^data$/i);
        const hHora = findCol(headers, /hora/i);
        const hPessoas = findCol(headers, /pessoas/i);
        const hTelefone = findCol(headers, /telefone|celular|whatsapp|fone|contato/i);
        const hValorTotal = findCol(headers, /valor\s*total/i);
        const hValorPago = findCol(headers, /valor\s*pago/i);
        const hFaltaPagar = findCol(headers, /falta\s*pagar/i);
        const hStatus = findCol(headers, /^status$/i);
        const hCidade = findCol(headers, /cidade/i);
        const hObs = findCol(headers, /observa[cç][oõ]es/i);
        const hCpf = findCol(headers, /cpf/i);

        let imported = 0;
        let skipped = 0;
        for (const row of rows) {
          const nomeResponsavel = hResponsavel ? row[hResponsavel] : "";
          if (!nomeResponsavel) { skipped++; continue; }

          const data = parseDateToIso(hData ? row[hData] : "") ?? new Date().toISOString().slice(0, 10);

          // Evita duplicar se o script rodar mais de uma vez
          const jaExiste = existentes.some(
            (r) => r.tipo === mapping.tipo && r.data === data && r.responsavel.nome === nomeResponsavel
          );
          if (jaExiste) { skipped++; continue; }

          const pessoas = parsePessoasTexto(hPessoas ? row[hPessoas] : undefined);
          const cpfsResponsavel = hCpf ? row[hCpf].split(",")[0]?.trim() : undefined;
          const valorTotal = hValorTotal ? parseMoneyBR(row[hValorTotal]) : pessoas.reduce((s, p) => s + p.valor, 0);
          const valorPago = hValorPago ? parseMoneyBR(row[hValorPago]) : 0;
          const faltaPagar = hFaltaPagar ? parseMoneyBR(row[hFaltaPagar]) : Math.max(valorTotal - valorPago, 0);
          const statusRaw = (hStatus ? row[hStatus] : "").toLowerCase();
          const status = statusRaw.includes("pago") && !statusRaw.includes("parc")
            ? "pago"
            : statusRaw.includes("parc")
              ? "parcial"
              : "pendente";

          createReserva({
            clientId,
            tipo: mapping.tipo,
            data,
            hora: hHora ? row[hHora] || undefined : undefined,
            responsavel: { nome: nomeResponsavel, cpf: cpfsResponsavel || undefined },
            telefone: hTelefone ? row[hTelefone] || undefined : undefined,
            pessoas: pessoas.length ? pessoas : [{ nome: nomeResponsavel, valor: valorTotal }],
            valorTotal,
            valorPago,
            faltaPagar,
            status,
            cidade: hCidade ? row[hCidade] || undefined : undefined,
            observacoes: hObs ? row[hObs] || undefined : undefined,
            origem: "manual",
          });
          imported++;
        }

        results.push({ aba: mapping.tabName, tipo: mapping.tipo, linhas: rows.length, importadas: imported, puladas: skipped });
      } catch (e) {
        results.push({ aba: mapping.tabName, erro: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Garante que os tipos usados nas planilhas fiquem disponíveis no dashboard
  upsertClient({ ...client, pousadaTipos: Array.from(tiposUniao.values()) });

  return NextResponse.json({ clientId, tipos: Array.from(tiposUniao.values()), results });
}
