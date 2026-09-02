/** Formata uma data ISO (YYYY-MM-DD) como "dom., 15/03/2026" — dia da
 *  semana abreviado + data completa (o Intl já devolve nesse formato
 *  pronto), mesmo padrão de weekday já usado em outras partes do sistema
 *  (ex: InboxView). "T00:00:00" evita o bug clássico de a data cair 1 dia
 *  antes por causa de fuso horário. */
export function formatDataComDiaSemana(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "Hoje" em AAAA-MM-DD ancorado no fuso de Brasília — nunca usar
 *  `new Date().toISOString().slice(0, 10)` pra isso, porque converte pra UTC
 *  antes de fatiar e devolve a data de AMANHÃ entre ~21h e 23h59 no horário
 *  de Brasília. */
export function todayBR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
