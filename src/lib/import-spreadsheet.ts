import { readSheet } from "read-excel-file/universal";
import { parse } from "csv-parse/browser/esm/sync";
import { unzipSync } from "fflate";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

export async function parseImportSpreadsheet(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<Record<string, string>[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("O arquivo deve ter até 5 MB.");
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (extension !== "csv" && extension !== "xlsx") throw new Error("Use um arquivo Excel (.xlsx) ou CSV.");
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("Arquivo muito grande.");
  let matrix: unknown[][];
  if (extension === "xlsx") {
    let bytes = 0, entries = 0;
    // Inspect central-directory sizes before any spreadsheet content is inflated.
    unzipSync(new Uint8Array(buffer), { filter(entry) {
      bytes += entry.originalSize; entries++;
      if (bytes > 40 * 1024 * 1024 || entry.originalSize > 16 * 1024 * 1024 || entries > 1000) throw new Error("Planilha expandida muito grande.");
      return false;
    } });
    matrix = await readSheet(buffer);
  } else {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const firstLine = text.split(/\r?\n/, 1)[0];
    const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
    let quoted = false;
    for (const character of firstLine) {
      if (character === '"') quoted = !quoted;
      else if (!quoted && counts.has(character)) counts.set(character, counts.get(character)! + 1);
    }
    const delimiter = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    matrix = parse(text, { delimiter, bom: true, skip_empty_lines: true, max_record_size: 64_000 });
  }
  if (matrix.length > MAX_ROWS + 1) throw new Error("Importe até 10 mil contatos por arquivo.");
  if (!matrix.length) return [];
  const headers = matrix[0].map((value, index) => String(value ?? "").trim() || `Coluna ${index + 1}`);
  if (headers.length > 100 || new Set(headers).size !== headers.length || headers.some(header => ["__proto__", "prototype", "constructor"].includes(header))) throw new Error("Cabeçalhos inválidos ou repetidos.");
  return matrix.slice(1).filter(row => row.some(value => value !== null && value !== "")).map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "")])));
}
