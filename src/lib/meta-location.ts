// Cidade e estado para a correspondência da Meta (ct/st), a partir de textos como
// "Campo Mourão – PR", "Maringá/PR", "Curitiba, Paraná" ou só "Paraná".
const STATES: Record<string, string> = {
  acre: "ac", alagoas: "al", amapa: "ap", amazonas: "am", bahia: "ba", ceara: "ce", "distrito federal": "df",
  "espirito santo": "es", goias: "go", maranhao: "ma", "mato grosso": "mt", "mato grosso do sul": "ms",
  "minas gerais": "mg", para: "pa", paraiba: "pb", parana: "pr", pernambuco: "pe", piaui: "pi",
  "rio de janeiro": "rj", "rio grande do norte": "rn", "rio grande do sul": "rs", rondonia: "ro", roraima: "rr",
  "santa catarina": "sc", "sao paulo": "sp", sergipe: "se", tocantins: "to",
};
const UFS = new Set(Object.values(STATES));

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Formato pedido pela Meta antes do hash: minúsculas, sem acento, espaço ou pontuação. */
export function metaCity(value: string): string {
  return plain(value).replace(/[^a-z]/g, "");
}

export function parseCityState(raw: unknown): { city?: string; state?: string } {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 120) return {};
  const parts = raw.split(/\s*[-–—\/,|]\s*/).map(part => part.trim()).filter(Boolean);
  const keys = parts.map(part => plain(part).replace(/\s+/g, " "));
  // UF de 2 letras tem prioridade; depois o nome do estado. Procura do fim, onde ela costuma ficar.
  let index = keys.map((key, i) => (UFS.has(key) ? i : -1)).filter(i => i >= 0).pop() ?? -1;
  if (index < 0) index = keys.map((key, i) => (STATES[key] ? i : -1)).filter(i => i >= 0).pop() ?? -1;
  const state = index >= 0 ? (UFS.has(keys[index]) ? keys[index] : STATES[keys[index]]) : undefined;
  const rest = parts.filter((_, i) => i !== index);
  const city = rest.length ? metaCity(rest[0]) : "";
  return { ...(city.length >= 2 ? { city } : {}), ...(state ? { state } : {}) };
}
