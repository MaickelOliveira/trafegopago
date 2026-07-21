import { NextRequest, NextResponse } from "next/server";
import { getClientById, upsertClient, getAllAgentConfigs } from "@/lib/clients";
import { getSheetHeadersCached, getAllRows, getSpreadsheetInfo } from "@/lib/google-sheets";
import { getReservas, createReserva, deleteReserva } from "@/lib/pousada";
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
  // DD/MM/AAAA ou DD-MM-AAAA — a planilha do Vitalli usa traço em vez de
  // barra em algumas abas ("18-07-2026"), o que antes caía silenciosamente
  // no fallback de "hoje" por não bater com nenhum dos dois regexes.
  const br = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
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

// O nome da aba salvo no sheetMapping às vezes não bate mais com o nome real
// da aba na planilha (o usuário renomeou depois de configurar, ex: "Pernoite"
// configurado vs "Pernoite- hospedagem " na planilha de verdade) — resolve
// por aproximação em vez de depender de igualdade exata.
function resolveTabName(tabName: string, realTabs: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const exact = realTabs.find((t) => norm(t) === norm(tabName));
  if (exact) return exact;
  const partial = realTabs.find((t) => norm(t).includes(norm(tabName)) || norm(tabName).includes(norm(t)));
  return partial ?? tabName;
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tipo"
  );
}

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId obrigatório" }, { status: 400 });

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  // ?reset=true apaga as reservas com origem "manual" (importadas) desse
  // cliente antes de reimportar do zero — útil pra reaplicar correções do
  // parser sem herdar dados de uma tentativa anterior. Nunca apaga reservas
  // origem "ia" (reais, vindas de conversas de verdade).
  if (req.nextUrl.searchParams.get("reset") === "true") {
    for (const r of getReservas(clientId)) {
      if (r.origem === "manual") deleteReserva(r.id);
    }
  }

  const agentConfigs = getAllAgentConfigs(client);
  const existentes = getReservas(clientId);
  const results: Record<string, unknown>[] = [];

  // Une todos os sheetMappings de todas as conexões num único conjunto de tipos,
  // deduplicando por LABEL normalizado (não pelo "tipo" bruto salvo em cada
  // sheetMapping — vários deles vieram com IDs gerados tipo "tipo_1782328965480"
  // e "Day Use"/"Day use" com capitalização diferente contavam como tipos
  // distintos antes desta correção).
  const labelByCanonical = new Map<string, string>();
  function registerLabel(label: string): string {
    const canon = slugify(label);
    if (!labelByCanonical.has(canon)) labelByCanonical.set(canon, label);
    return canon;
  }
  for (const t of client.pousadaTipos ?? []) registerLabel(t.label);
  for (const cfg of agentConfigs) {
    for (const m of cfg.sheetMappings ?? []) registerLabel(m.label);
  }

  for (const cfg of agentConfigs) {
    if (!cfg.googleRefreshToken || !cfg.spreadsheetId || !cfg.sheetMappings?.length) continue;

    let realTabs: string[] = [];
    try {
      const info = await getSpreadsheetInfo(cfg.googleRefreshToken, cfg.spreadsheetId);
      realTabs = info.tabs.map((t) => t.title);
      results.push({
        planilha: info.title,
        spreadsheetId: cfg.spreadsheetId,
        abasReais: realTabs,
        abasMapeadas: cfg.sheetMappings.map((m) => m.tabName),
      });
    } catch (e) {
      results.push({ spreadsheetId: cfg.spreadsheetId, erroListandoAbas: e instanceof Error ? e.message : String(e) });
    }

    for (const mapping of cfg.sheetMappings) {
      const canonTipo = slugify(mapping.label);
      const tabName = resolveTabName(mapping.tabName, realTabs);
      try {
        const headers = await getSheetHeadersCached(cfg.googleRefreshToken, cfg.spreadsheetId, tabName);
        if (!headers.length) {
          results.push({ aba: tabName, skipped: "sem cabeçalho" });
          continue;
        }
        const rows = await getAllRows(cfg.googleRefreshToken, cfg.spreadsheetId, tabName, headers);

        const hResponsavel =
          findCol(headers, /respons[aá]vel/i) ??
          findCol(headers, /^nome$/i) ??
          findCol(headers, /cliente/i) ??
          findCol(headers, /titular/i);
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
        // Abas de hospedagem/pernoite têm colunas próprias (sem "Pessoas" em
        // texto livre) que não podem se perder na migração
        const hQuarto = findCol(headers, /quarto|chal[eé]/i);
        const hCheckout = findCol(headers, /check-?\s*out/i);

        let imported = 0;
        let skipped = 0;
        let semData = 0;
        let amostraPessoasTexto: string | undefined;
        let amostraPessoasParsed: Pessoa[] | undefined;
        for (const row of rows) {
          const nomeResponsavel = hResponsavel ? row[hResponsavel] : "";
          if (!nomeResponsavel) { skipped++; continue; }

          // Se a data não for reconhecível, pula em vez de gravar com "hoje"
          // silenciosamente (já aconteceu de uma reserva real virar "hoje"
          // por causa disso) — melhor faltar do que gravar errado.
          const data = parseDateToIso(hData ? row[hData] : "");
          if (!data) { semData++; skipped++; continue; }

          // Evita duplicar se o script rodar mais de uma vez OU se a mesma
          // reserva aparecer em mais de uma planilha/aba nesta MESMA execução
          // (existentes é atualizado a cada gravação, não é uma foto do início)
          const jaExiste = existentes.some(
            (r) => r.tipo === canonTipo && r.data === data && r.responsavel.nome === nomeResponsavel
          );
          if (jaExiste) { skipped++; continue; }

          const pessoas = parsePessoasTexto(hPessoas ? row[hPessoas] : undefined);
          if (amostraPessoasTexto === undefined && hPessoas && row[hPessoas]) {
            amostraPessoasTexto = row[hPessoas];
            amostraPessoasParsed = pessoas;
          }
          const cpfsResponsavel = hCpf ? row[hCpf].split(",")[0]?.trim() : undefined;
          // Usa a coluna só se a CÉLULA tiver valor — coluna existir mas
          // célula vazia (ex: "Falta Pagar" em branco numa reserva parcial)
          // deve cair no fallback calculado, não virar 0 silenciosamente.
          const valorTotal = hValorTotal && row[hValorTotal]
            ? parseMoneyBR(row[hValorTotal])
            : pessoas.reduce((s, p) => s + p.valor, 0);
          const valorPago = hValorPago && row[hValorPago] ? parseMoneyBR(row[hValorPago]) : 0;
          const faltaPagar = hFaltaPagar && row[hFaltaPagar]
            ? parseMoneyBR(row[hFaltaPagar])
            : Math.max(valorTotal - valorPago, 0);
          const statusRaw = (hStatus ? row[hStatus] : "").toLowerCase();
          const status = statusRaw.includes("pago") && !statusRaw.includes("parc")
            ? "pago"
            : statusRaw.includes("parc")
              ? "parcial"
              : "pendente";

          const criada = createReserva({
            clientId,
            tipo: canonTipo,
            data,
            dataCheckout: hCheckout ? parseDateToIso(row[hCheckout]) : undefined,
            quarto: hQuarto && row[hQuarto] ? row[hQuarto] : undefined,
            hora: hHora ? row[hHora] || undefined : undefined,
            responsavel: { nome: nomeResponsavel, cpf: cpfsResponsavel || undefined },
            telefone: hTelefone ? row[hTelefone] || undefined : undefined,
            pessoas: pessoas.length ? pessoas : [{ nome: nomeResponsavel, valor: valorTotal }],
            valorTotal,
            valorPago,
            faltaPagar,
            status,
            cidade: hCidade ? row[hCidade] || undefined : undefined,
            observacoes: hObs && row[hObs] ? row[hObs] : undefined,
            origem: "manual",
          });
          existentes.push(criada);
          imported++;
        }

        results.push({
          aba: tabName,
          abaConfigurada: mapping.tabName,
          tipo: canonTipo,
          headers,
          colunaResponsavelDetectada: hResponsavel ?? null,
          linhas: rows.length,
          importadas: imported,
          puladas: skipped,
          puladasPorDataInvalida: semData,
          amostraPessoasTexto: amostraPessoasTexto ?? null,
          amostraPessoasParsed: amostraPessoasParsed ?? null,
        });
      } catch (e) {
        results.push({ aba: tabName, abaConfigurada: mapping.tabName, tipo: canonTipo, erro: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Garante que os tipos usados nas planilhas fiquem disponíveis no dashboard,
  // já deduplicados por label
  const tiposFinais: PousadaTipo[] = Array.from(labelByCanonical.entries()).map(([slug, label]) => ({ slug, label }));
  upsertClient({ ...client, pousadaTipos: tiposFinais });

  return NextResponse.json({ clientId, tipos: tiposFinais, results });
}
