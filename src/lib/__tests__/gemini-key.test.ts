import { describe, expect, it } from "vitest";
import { isGeminiApiKey, resolveGeminiApiKeyUpdate } from "@/lib/gemini-key";

const VALID = "AIza" + "A".repeat(35);

describe("gemini key update", () => {
  it("aceita chave no formato do Google AI Studio", () => {
    expect(isGeminiApiKey(VALID)).toBe(true);
    expect(resolveGeminiApiKeyUpdate(`  ${VALID}  `, "old")).toBe(VALID);
  });

  it("mantém a chave atual quando chega vazio", () => {
    expect(resolveGeminiApiKeyUpdate("", "AIzaAtual")).toBe("AIzaAtual");
    expect(resolveGeminiApiKeyUpdate(undefined, "AIzaAtual")).toBe("AIzaAtual");
  });

  it("ignora senha preenchida pelo autocompletar do navegador", () => {
    expect(isGeminiApiKey("minhaSenha12")).toBe(false);
    expect(resolveGeminiApiKeyUpdate("minhaSenha12", VALID)).toBe(VALID);
  });
});
