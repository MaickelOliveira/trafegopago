import { describe, expect, it } from "vitest";
import {
  distribuirPagamentoPelasPessoas,
  distribuirValorTotalPelasPessoas,
  faltaPagarPessoa,
  pessoasComPagamentos,
  somarValorPessoas,
  somarValorPagoPessoas,
  statusPagamentoPessoa,
  statusPorPagamentos,
} from "../pousada-payments";

describe("pagamentos individuais de reservas", () => {
  const pessoas = [
    { nome: "Ana", valor: 130 },
    { nome: "Bruno", valor: 65 },
    { nome: "Criança", valor: 0, gratuito: true },
  ];

  it("distribui o pagamento agregado proporcionalmente e sem perder centavos", () => {
    const result = distribuirPagamentoPelasPessoas(pessoas, 97.51);

    expect(somarValorPagoPessoas(result)).toBe(97.51);
    expect(result[0].valorPago).toBe(65.01);
    expect(result[1].valorPago).toBe(32.5);
    expect(result[2].valorPago).toBe(0);
  });

  it("soma valores individuais em centavos sem exibir uma sequência de noves", () => {
    const result = somarValorPessoas(
      Array.from({ length: 25 }, (_, index) => ({ nome: `Pessoa ${index + 1}`, valor: 0.12 })),
    );

    expect(result).toBe(3);
    expect(String(result)).toBe("3");
  });

  it("preserva pagamentos individuais e calcula o saldo de cada pessoa", () => {
    const result = pessoasComPagamentos([
      { nome: "Ana", valor: 130, valorPago: 50 },
      { nome: "Bruno", valor: 65, valorPago: 65 },
    ], 0);

    expect(result.map(faltaPagarPessoa)).toEqual([80, 0]);
    expect(somarValorPagoPessoas(result)).toBe(115);
  });

  it("divide igualmente a alteração do valor total sem mexer em pessoas gratuitas", () => {
    const result = distribuirValorTotalPelasPessoas([
      { nome: "Ana", valor: 130, valorPago: 130 },
      { nome: "Bruno", valor: 65, valorPago: 20 },
      { nome: "Criança", valor: 0, valorPago: 0, gratuito: true },
    ], 234);

    expect(result.map((pessoa) => pessoa.valor)).toEqual([117, 117, 0]);
    expect(result.map((pessoa) => pessoa.valorPago)).toEqual([117, 20, 0]);
    expect(result[2].gratuito).toBe(true);
  });

  it("divide centavos sem alterar o valor total informado", () => {
    const result = distribuirValorTotalPelasPessoas([
      { nome: "Ana", valor: 0 },
      { nome: "Bruno", valor: 0 },
      { nome: "Carla", valor: 0 },
    ], 100);

    expect(result.map((pessoa) => pessoa.valor)).toEqual([33.34, 33.33, 33.33]);
    expect(somarValorPessoas(result)).toBe(100);
  });

  it("mantém o status coerente com os valores", () => {
    expect(statusPorPagamentos("pendente", 195, 0)).toBe("pendente");
    expect(statusPorPagamentos("pendente", 195, 50)).toBe("parcial");
    expect(statusPorPagamentos("parcial", 195, 195)).toBe("pago");
    expect(statusPorPagamentos("pendente", 0, 0)).toBe("cortesia");
    expect(statusPorPagamentos("cancelada", 195, 195)).toBe("cancelada");
    expect(statusPorPagamentos("pendente", 0, 0, true)).toBe("pendente");
    expect(statusPorPagamentos("parcial", 0, 0, true)).toBe("parcial");
    expect(statusPorPagamentos("pago", 0, 0, true)).toBe("pago");
  });

  it("mantém o status de pagamento coerente para cada pessoa", () => {
    expect(statusPagamentoPessoa({ nome: "Ana", valor: 130, valorPago: 0 })).toBe("pendente");
    expect(statusPagamentoPessoa({ nome: "Ana", valor: 130, valorPago: 50 })).toBe("parcial");
    expect(statusPagamentoPessoa({ nome: "Ana", valor: 130, valorPago: 130 })).toBe("pago");
    expect(statusPagamentoPessoa({ nome: "Ana", valor: 0, gratuito: true })).toBe("cortesia");
  });
});
