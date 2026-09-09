import { describe, expect, it } from "vitest";
import { tipoUsaValorPorPacote } from "../pousada-types";

describe("modelo de cobrança dos tipos de reserva", () => {
  it("trata hospedagem e pernoite como pacote", () => {
    expect(tipoUsaValorPorPacote({ slug: "hospedagem", label: "Hospedagem", categoria: "hospedagem" })).toBe(true);
    expect(tipoUsaValorPorPacote("Pernoite/hospedagem")).toBe(true);
  });

  it("trata serviços corporativos como pacote mesmo sendo eventos", () => {
    expect(tipoUsaValorPorPacote({
      slug: "corporativo_almoco_janta",
      label: "CORPORATIVO / ALMOÇO - JANTA.",
      categoria: "evento",
    })).toBe(true);
    expect(tipoUsaValorPorPacote("Evento corporativo")).toBe(true);
  });

  it("mantém day use e almoço comum com cobrança por pessoa", () => {
    expect(tipoUsaValorPorPacote({ slug: "day_use", label: "Day use", categoria: "evento" })).toBe(false);
    expect(tipoUsaValorPorPacote({ slug: "almoco", label: "Almoço final de semana", categoria: "evento" })).toBe(false);
  });
});
