import type { ItemConsumoHospede, Pessoa } from "./pousada-types";

function inteiroNaoNegativo(value: unknown): number {
  return Math.max(Math.floor(Number(value) || 0), 0);
}

function dinheiroNaoNegativo(value: unknown): number {
  return Math.max(Math.round((Number(value) || 0) * 100) / 100, 0);
}

export function normalizarItensConsumo(
  itens: Array<Partial<ItemConsumoHospede>> | undefined,
): ItemConsumoHospede[] {
  return (itens ?? [])
    .filter((item) => typeof item.nome === "string" && item.nome.trim().length > 0)
    .map((item, index) => {
      const quantidadeColocada = inteiroNaoNegativo(item.quantidadeColocada);
      return {
        id: typeof item.id === "string" && item.id.trim() ? item.id : `consumo-${index + 1}`,
        nome: item.nome!.trim(),
        local: item.local === "quarto" ? "quarto" : "frigobar",
        quantidadeColocada,
        quantidadeConsumida: Math.min(inteiroNaoNegativo(item.quantidadeConsumida), quantidadeColocada),
        valorUnitario: dinheiroNaoNegativo(item.valorUnitario),
      };
    });
}

export function normalizarConsumoPessoa(pessoa: Pessoa): Pessoa {
  const itensConsumo = normalizarItensConsumo(pessoa.itensConsumo);
  const consumoConferido = itensConsumo.length > 0 && pessoa.consumoConferido === true;
  return {
    ...pessoa,
    itensConsumo: itensConsumo.length > 0 ? itensConsumo : undefined,
    consumoConferido,
    consumoConferidoEm: consumoConferido ? pessoa.consumoConferidoEm : undefined,
  };
}

function identificadoresPessoa(pessoa: Pessoa): string[] {
  const nome = pessoa.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const cpf = pessoa.cpf?.replace(/\D/g, "");
  const telefone = pessoa.telefone?.replace(/\D/g, "");
  return [cpf ? `cpf:${cpf}` : "", telefone ? `telefone:${telefone}` : "", nome ? `nome:${nome}` : ""].filter(Boolean);
}

/** Preserva o controle operacional quando uma integração antiga ou a IA
 * atualiza os dados cadastrais dos hóspedes sem conhecer os campos de consumo. */
export function preservarConsumoExistente(novas: Pessoa[], atuais: Pessoa[]): Pessoa[] {
  const usados = new Set<number>();
  return novas.map((nova, index) => {
    const informouConsumo = ["itensConsumo", "consumoConferido", "consumoConferidoEm"]
      .some((campo) => Object.prototype.hasOwnProperty.call(nova, campo));
    if (informouConsumo) return nova;

    const identificadores = identificadoresPessoa(nova);
    let indiceAtual = -1;
    // CPF e nome identificam melhor que telefone: em reservas de família,
    // todos os hóspedes podem repetir o telefone do responsável.
    for (const prefixo of ["cpf:", "nome:", "telefone:"]) {
      const identificador = identificadores.find((id) => id.startsWith(prefixo));
      if (!identificador) continue;
      indiceAtual = atuais.findIndex((atual, atualIndex) =>
        !usados.has(atualIndex) && identificadoresPessoa(atual).includes(identificador)
      );
      if (indiceAtual >= 0) break;
    }
    if (indiceAtual < 0 && atuais[index] && !usados.has(index)) indiceAtual = index;
    if (indiceAtual < 0) return nova;

    usados.add(indiceAtual);
    const atual = atuais[indiceAtual];
    return {
      ...nova,
      itensConsumo: atual.itensConsumo,
      consumoConferido: atual.consumoConferido,
      consumoConferidoEm: atual.consumoConferidoEm,
    };
  });
}

export function totalConsumoHospede(pessoa: Pessoa): number {
  const centavos = normalizarItensConsumo(pessoa.itensConsumo).reduce(
    (total, item) => total + item.quantidadeConsumida * Math.round(item.valorUnitario * 100),
    0,
  );
  return centavos / 100;
}

export function totalConsumoPessoas(pessoas: Pessoa[]): number {
  return Math.round(pessoas.reduce((total, pessoa) => total + totalConsumoHospede(pessoa), 0) * 100) / 100;
}

export type ItemConsumidoReserva = {
  hospede: string;
  item: string;
  local: ItemConsumoHospede["local"];
  quantidade: number;
  valorUnitario: number;
  subtotal: number;
};

/** Linhas prontas para relatórios: mostra somente o que foi efetivamente
 * consumido, mantendo o hóspede e o local para facilitar a conferência. */
export function listarItensConsumidos(pessoas: Pessoa[]): ItemConsumidoReserva[] {
  return pessoas.flatMap((pessoa) => normalizarItensConsumo(pessoa.itensConsumo)
    .filter((item) => item.quantidadeConsumida > 0)
    .map((item) => ({
      hospede: pessoa.nome,
      item: item.nome,
      local: item.local,
      quantidade: item.quantidadeConsumida,
      valorUnitario: item.valorUnitario,
      subtotal: Math.round(item.quantidadeConsumida * item.valorUnitario * 100) / 100,
    })));
}

export function quantidadesConsumo(pessoa: Pessoa): { colocada: number; consumida: number } {
  return normalizarItensConsumo(pessoa.itensConsumo).reduce(
    (total, item) => ({
      colocada: total.colocada + item.quantidadeColocada,
      consumida: total.consumida + item.quantidadeConsumida,
    }),
    { colocada: 0, consumida: 0 },
  );
}
