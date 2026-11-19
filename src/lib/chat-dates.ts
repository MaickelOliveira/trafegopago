const timeZone = "America/Sao_Paulo";
const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" });

export function chatDayKey(ts: number): string {
  return Number.isFinite(ts) && !Number.isNaN(new Date(ts).getTime()) ? dayFormatter.format(new Date(ts)) : "undated";
}

export function chatDayLabel(ts: number, now = Date.now()): string {
  const key = chatDayKey(ts);
  if (key === "undated") return "Data não informada";
  const today = chatDayKey(now);
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const date = dateFormatter.format(new Date(ts));
  return key === today ? `Hoje · ${date}` : key === yesterday.toISOString().slice(0, 10) ? `Ontem · ${date}` : date;
}

export function chatTime(ts: number): string {
  return chatDayKey(ts) === "undated" ? "—" : timeFormatter.format(new Date(ts));
}

/** Preserve the stored message order and separate complete Brazilian calendar dates. */
export function groupChatMessages<T extends { ts: number }>(messages: readonly T[], now = Date.now()) {
  const groups: { key: string; label: string; messages: T[] }[] = [];
  for (const message of messages) {
    const key = chatDayKey(message.ts);
    if (!groups.length || groups.at(-1)!.key !== key) groups.push({ key, label: chatDayLabel(message.ts, now), messages: [] });
    groups.at(-1)!.messages.push(message);
  }
  return groups;
}
