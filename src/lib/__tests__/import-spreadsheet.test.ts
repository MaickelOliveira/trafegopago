import { describe, expect, it } from "vitest";
import { parseImportSpreadsheet } from "../import-spreadsheet";
const file = (text: string) => new File([text], "contacts.csv", { type: "text/csv" });
describe("spreadsheet imports", () => {
  it("preserves quoted separators, newlines and Brazilian decimal values", async () => {
    expect(await parseImportSpreadsheet(file('Nome;Telefone;Valor;Notas\n"Maria; Silva";44999999999;"1.234,50";"linha 1\nlinha 2"'))).toEqual([{ Nome: "Maria; Silva", Telefone: "44999999999", Valor: "1.234,50", Notas: "linha 1\nlinha 2" }]);
  });
  it("rejects duplicate or prototype-related column names", async () => {
    await expect(parseImportSpreadsheet(file("Nome,Nome\na,b"))).rejects.toThrow();
    await expect(parseImportSpreadsheet(file("__proto__,Telefone\nx,123"))).rejects.toThrow();
  });
  it("rejects oversized files before reading their contents", async () => {
    const candidate = { name: "x.xlsx", size: 6 * 1024 * 1024, arrayBuffer: async () => { throw new Error("must not read"); } };
    await expect(parseImportSpreadsheet(candidate)).rejects.toThrow("5 MB");
  });
});
