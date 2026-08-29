// Todo horário configurado nas telas do gestor (resumo diário, automações
// "todo dia às HH:MM", reset de reativação à meia-noite) é sempre pensado em
// horário de Brasília — mas o servidor (container Docker) nem sempre roda no
// fuso America/Sao_Paulo; se rodar em UTC (comum em imagens base sem TZ
// configurado), `new Date().getHours()` compara contra um horário 3h
// adiantado e o disparo nunca bate na janela esperada. Usar Intl com timeZone
// explícito remove essa ambiguidade — sempre Brasília, independente de como
// o processo Node está configurado.
const TZ = "America/Sao_Paulo";

function partsInSaoPaulo(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** Horário atual em Brasília, formato "HH:MM" — 24h. */
export function currentHHMMBrasilia(): string {
  const p = partsInSaoPaulo(new Date());
  // Intl pode devolver "24" à meia-noite em algumas runtimes — normaliza pra "00".
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${hour}:${p.minute}`;
}

/** Data atual em Brasília, formato ISO "AAAA-MM-DD". */
export function todayISOBrasilia(): string {
  const p = partsInSaoPaulo(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

/** Data (AAAA-MM-DD) em Brasília de um timestamp qualquer (epoch ms) — usado
 *  pra decidir se uma atividade aconteceu "hoje" pelo relógio de Brasília, não
 *  pelo corte de dia em UTC (uma conversa às 22h de Brasília ainda é "hoje"
 *  mesmo já sendo 01h UTC do dia seguinte). */
export function dateISOBrasilia(ms: number): string {
  const p = partsInSaoPaulo(new Date(ms));
  return `${p.year}-${p.month}-${p.day}`;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana atual em Brasília — 0=domingo...6=sábado (mesma convenção de
 *  Date.getDay()), mas calculado no fuso certo em vez do fuso do processo. */
export function currentWeekdayBrasilia(): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date());
  return WEEKDAY_INDEX[short] ?? new Date().getDay();
}

/** Início do dia atual em Brasília (00:00), como timestamp UTC em ms —
 *  usado pra comparar "pausado antes de hoje" (reativação por reset à
 *  meia-noite) sem depender do fuso do processo Node. */
export function startOfTodayBrasiliaMs(): number {
  const p = partsInSaoPaulo(new Date());
  // Brasília é sempre UTC-3 (sem horário de verão desde 2019) — meia-noite em
  // Brasília é 03:00 UTC do mesmo dia.
  return Date.parse(`${p.year}-${p.month}-${p.day}T03:00:00.000Z`);
}
