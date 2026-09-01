/** Formata uma data ISO (YYYY-MM-DD) como "dom., 15/03/2026" — dia da
 *  semana abreviado + data completa (o Intl já devolve nesse formato
 *  pronto), mesmo padrão de weekday já usado em outras partes do sistema
 *  (ex: InboxView). "T00:00:00" evita o bug clássico de a data cair 1 dia
 *  antes por causa de fuso horário. */
export function formatDataComDiaSemana(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
