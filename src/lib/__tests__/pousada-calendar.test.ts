import { describe, expect, it } from "vitest";
import {
  calendarDays,
  dateFromISO,
  intervalOverlapsMonth,
  isoDateLocal,
  monthBounds,
} from "../pousada-calendar";

describe("datas da agenda da pousada", () => {
  it("monta o mês completo começando no domingo e terminando no sábado", () => {
    const days = calendarDays(new Date(2026, 8, 1, 12));

    expect(days[0]).toBe("2026-08-30");
    expect(days.at(-1)).toBe("2026-10-03");
    expect(days.length % 7).toBe(0);
  });

  it("calcula os limites reais do mês", () => {
    expect(monthBounds(new Date(2028, 1, 10, 12))).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("inclui hospedagens que começaram antes mas atravessam o mês", () => {
    const september = new Date(2026, 8, 1, 12);

    expect(intervalOverlapsMonth("2026-08-29", "2026-09-03", september)).toBe(true);
    expect(intervalOverlapsMonth("2026-09-30", "2026-10-02", september)).toBe(true);
    expect(intervalOverlapsMonth("2026-08-01", "2026-08-31", september)).toBe(false);
  });

  it("converte ISO sem deslocar o dia pelo fuso horário", () => {
    const value = "2026-05-10";
    expect(isoDateLocal(dateFromISO(value))).toBe(value);
  });
});
