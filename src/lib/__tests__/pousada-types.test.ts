import { describe, expect, it } from "vitest";
import {
  mesclarTiposComHistorico,
  normalizarPousadaTipo,
  tipoUsaValorPorPacote,
} from "../pousada-types";

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

  it("trata casamento e fotos como lote/data fechada", () => {
    expect(tipoUsaValorPorPacote({
      slug: "casamento_fotos",
      label: "Casamento/Fotos",
      categoria: "evento",
    })).toBe(true);
  });

  it("permite substituir os padrões antigos por qualquer cobrança escolhida", () => {
    expect(tipoUsaValorPorPacote({
      slug: "hospedagem",
      label: "Hospedagem",
      categoria: "hospedagem",
      cobranca: "individual",
    })).toBe(false);
    expect(tipoUsaValorPorPacote({
      slug: "casamento_fotos",
      label: "Casamento/Fotos",
      categoria: "evento",
      cobranca: "individual",
    })).toBe(false);
    expect(normalizarPousadaTipo({
      slug: "corporativo",
      label: "Corporativo",
      categoria: "evento",
      cobranca: "individual",
    }).cobranca).toBe("individual");
  });

  it("mantém day use e almoço comum com cobrança por pessoa", () => {
    expect(tipoUsaValorPorPacote({ slug: "day_use", label: "Day use", categoria: "evento" })).toBe(false);
    expect(tipoUsaValorPorPacote({ slug: "almoco", label: "Almoço final de semana", categoria: "evento" })).toBe(false);
  });

  it("respeita a cobrança escolhida nos demais eventos", () => {
    expect(tipoUsaValorPorPacote({
      slug: "aniversario",
      label: "Aniversário",
      categoria: "evento",
      cobranca: "lote",
    })).toBe(true);
    expect(tipoUsaValorPorPacote({
      slug: "almoco_final_semana",
      label: "Almoço final de semana",
      categoria: "evento",
      cobranca: "individual",
    })).toBe(false);
  });

  it("normaliza cadastros antigos com os padrões solicitados", () => {
    expect(normalizarPousadaTipo({
      slug: "casamento_fotos",
      label: "Casamento/Fotos",
      categoria: "evento",
    }).cobranca).toBe("lote");
    expect(normalizarPousadaTipo({
      slug: "almoco_final_semana",
      label: "Almoço final de semana",
      categoria: "evento",
    }).cobranca).toBe("individual");
  });

  it("arquiva o tipo removido em vez de apagá-lo do histórico", () => {
    const result = mesclarTiposComHistorico(
      [
        { slug: "almoco", label: "Almoço", categoria: "evento", cobranca: "individual" },
        { slug: "casamento_fotos", label: "Casamento/Fotos", categoria: "evento", cobranca: "lote" },
      ],
      [
        { slug: "almoco", label: "Almoço", categoria: "evento", cobranca: "individual" },
      ],
    );

    expect(result).toEqual([
      { slug: "almoco", label: "Almoço", categoria: "evento", cobranca: "individual", ativo: true },
      { slug: "casamento_fotos", label: "Casamento/Fotos", categoria: "evento", cobranca: "lote", ativo: false },
    ]);
  });
});
