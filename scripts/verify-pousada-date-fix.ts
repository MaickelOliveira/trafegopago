import { writeFileSync, existsSync, unlinkSync } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "pousada-reservas.json");
const preExisting = existsSync(FILE);
if (preExisting) {
  throw new Error("data/pousada-reservas.json já existe — abortando pra não sobrescrever dados reais.");
}

const CLIENT_ID = "__verify_test_client__";

const fakeReserva = {
  id: "test-1",
  clientId: CLIENT_ID,
  tipo: "almoco",
  // Reproduz exatamente o bug relatado: data gravada com sufixo de horário
  // em vez de "YYYY-MM-DD" puro (ex: escapou de algum path de escrita antigo).
  data: "2026-09-06T00:00:00.000Z",
  responsavel: { nome: "Soeli Gomes dos Santos Iastremski" },
  telefone: "5544998249900",
  pessoas: [{ nome: "Soeli Gomes dos Santos Iastremski", idade: 51, valor: 85 }],
  valorTotal: 595,
  valorPago: 0,
  faltaPagar: 595,
  status: "pendente",
  origem: "manual",
  createdAt: "2026-09-02T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z",
};

writeFileSync(FILE, JSON.stringify([fakeReserva], null, 2));

async function main() {
  const { getReservasFiltradas } = await import("../src/lib/pousada");
  const { todayBR } = await import("../src/lib/format-date");

  console.log("todayBR() =", todayBR(), "(deve ser AAAA-MM-DD, hoje em horário de Brasília)");

  const exato = getReservasFiltradas(CLIENT_ID, { tipo: "almoco", dataInicio: "2026-09-06", dataFim: "2026-09-06" });
  console.log(`Filtro De=Até=2026-09-06 (repro exato do bug): ${exato.length} reserva(s) encontrada(s)`);
  if (exato.length !== 1) {
    throw new Error("FALHOU: a reserva com data corrompida não apareceu no filtro de dia exato — bug não corrigido.");
  }
  console.log("data normalizada de volta:", JSON.stringify(exato[0].data), "(deve ter exatamente 10 caracteres)");
  if (exato[0].data.length !== 10) {
    throw new Error("FALHOU: data não foi normalizada pra 10 caracteres.");
  }

  const semTipo = getReservasFiltradas(CLIENT_ID, { dataInicio: "2026-09-05", dataFim: "2026-09-05" });
  console.log(`Filtro De=Até=2026-09-05 (dia errado, não deve achar nada): ${semTipo.length} reserva(s)`);
  if (semTipo.length !== 0) {
    throw new Error("FALHOU: apareceu num dia que não é o da reserva.");
  }

  console.log("\n✅ Fix confirmado: reserva com data malformada agora é encontrada corretamente pelo filtro de dia exato.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try { unlinkSync(FILE); } catch {}
  });
