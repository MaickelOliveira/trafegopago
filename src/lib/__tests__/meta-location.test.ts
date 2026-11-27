import { describe, expect, it } from "vitest";
import { metaCity, parseCityState } from "../meta-location";

describe("cidade e estado para a Meta", () => {
  it.each([
    ["Campo Mourão – PR", { city: "campomourao", state: "pr" }],
    ["Maringá/PR", { city: "maringa", state: "pr" }],
    ["Curitiba, Paraná", { city: "curitiba", state: "pr" }],
    ["Paraná", { state: "pr" }],
    ["São Paulo - SP", { city: "saopaulo", state: "sp" }],
    ["Cruzeiro do Oeste", { city: "cruzeirodooeste" }],
  ])("lê %s", (raw, expected) => {
    expect(parseCityState(raw)).toEqual(expected);
  });
  it("ignora valores vazios ou estranhos", () => {
    expect(parseCityState("")).toEqual({});
    expect(parseCityState(undefined)).toEqual({});
    expect(parseCityState("x".repeat(200))).toEqual({});
  });
  it("normaliza como a Meta pede", () => {
    expect(metaCity("Foz do Iguaçu")).toBe("fozdoiguacu");
  });
});
