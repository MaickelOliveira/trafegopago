import { describe, expect, it } from "vitest";
import {
  normalizarConsumoPessoa,
  normalizarItensConsumo,
  preservarConsumoExistente,
  quantidadesConsumo,
  totalConsumoHospede,
  totalConsumoPessoas,
} from "../pousada-consumo";

describe("controle de consumo da hospedagem", () => {
  it("normaliza quantidades, preço e descarta item sem nome", () => {
    const itens = normalizarItensConsumo([
      { id: "agua", nome: " Água ", local: "frigobar", quantidadeColocada: 4.8, quantidadeConsumida: 6, valorUnitario: 5.999 },
      { id: "vazio", nome: " ", local: "quarto", quantidadeColocada: 1, quantidadeConsumida: 1, valorUnitario: 10 },
    ]);

    expect(itens).toEqual([{
      id: "agua",
      nome: "Água",
      local: "frigobar",
      quantidadeColocada: 4,
      quantidadeConsumida: 4,
      valorUnitario: 6,
    }]);
  });

  it("calcula unidades e total consumido por hóspede e reserva", () => {
    const ana = {
      nome: "Ana",
      valor: 200,
      itensConsumo: [
        { id: "agua", nome: "Água", local: "frigobar" as const, quantidadeColocada: 4, quantidadeConsumida: 2, valorUnitario: 6 },
        { id: "cafe", nome: "Café", local: "quarto" as const, quantidadeColocada: 2, quantidadeConsumida: 1, valorUnitario: 4.5 },
      ],
    };

    expect(quantidadesConsumo(ana)).toEqual({ colocada: 6, consumida: 3 });
    expect(totalConsumoHospede(ana)).toBe(16.5);
    expect(totalConsumoPessoas([ana, { nome: "Bruno", valor: 200 }])).toBe(16.5);
  });

  it("só mantém a conferência quando existem itens", () => {
    expect(normalizarConsumoPessoa({ nome: "Ana", valor: 100, consumoConferido: true }).consumoConferido).toBe(false);
  });

  it("preserva consumos quando a IA atualiza o cadastro sem enviar esses campos", () => {
    const item = { id: "agua", nome: "Água", local: "frigobar" as const, quantidadeColocada: 2, quantidadeConsumida: 1, valorUnitario: 6 };
    const atuais = [{ nome: "José da Silva", cpf: "123.456.789-00", valor: 100, itensConsumo: [item], consumoConferido: true }];
    const novas = [{ nome: "Jose da Silva", cpf: "12345678900", valor: 120 }];

    expect(preservarConsumoExistente(novas, atuais)[0]).toMatchObject({
      itensConsumo: [item],
      consumoConferido: true,
    });
  });

  it("prioriza o nome quando vários hóspedes usam o telefone do responsável", () => {
    const atuais = [
      { nome: "Ana", telefone: "44999999999", valor: 100, itensConsumo: [{ id: "agua", nome: "Água", local: "frigobar" as const, quantidadeColocada: 1, quantidadeConsumida: 1, valorUnitario: 6 }] },
      { nome: "Bruno", telefone: "44999999999", valor: 100, itensConsumo: [{ id: "cafe", nome: "Café", local: "quarto" as const, quantidadeColocada: 1, quantidadeConsumida: 1, valorUnitario: 4 }] },
    ];
    const novas = [
      { nome: "Bruno", telefone: "44999999999", valor: 100 },
      { nome: "Ana", telefone: "44999999999", valor: 100 },
    ];

    const preservadas = preservarConsumoExistente(novas, atuais);
    expect(preservadas[0].itensConsumo?.[0].nome).toBe("Café");
    expect(preservadas[1].itensConsumo?.[0].nome).toBe("Água");
  });
});
