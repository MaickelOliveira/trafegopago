export type CorAgenda = {
  principal: string;
  fundo: string;
  fundoForte: string;
};

// Cores escolhidas para continuarem legíveis em fundo branco e distinguíveis
// entre si. A posição do tipo na configuração da pousada define sua cor.
export const CORES_AGENDA: CorAgenda[] = [
  { principal: "#2563eb", fundo: "#eff6ff", fundoForte: "#dbeafe" },
  { principal: "#059669", fundo: "#ecfdf5", fundoForte: "#d1fae5" },
  { principal: "#d97706", fundo: "#fffbeb", fundoForte: "#fef3c7" },
  { principal: "#db2777", fundo: "#fdf2f8", fundoForte: "#fce7f3" },
  { principal: "#7c3aed", fundo: "#f5f3ff", fundoForte: "#ede9fe" },
  { principal: "#0891b2", fundo: "#ecfeff", fundoForte: "#cffafe" },
  { principal: "#dc2626", fundo: "#fef2f2", fundoForte: "#fee2e2" },
  { principal: "#4f46e5", fundo: "#eef2ff", fundoForte: "#e0e7ff" },
];

export const COR_EVENTO_GERAL: CorAgenda = {
  principal: "#475569",
  fundo: "#f8fafc",
  fundoForte: "#e2e8f0",
};

export function isoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromISO(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function monthBounds(month: Date): { start: string; end: string } {
  return {
    start: isoDateLocal(new Date(month.getFullYear(), month.getMonth(), 1, 12)),
    end: isoDateLocal(new Date(month.getFullYear(), month.getMonth() + 1, 0, 12)),
  };
}

export function calendarDays(month: Date): string[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
  const start = new Date(first);
  const end = new Date(last);
  start.setDate(first.getDate() - first.getDay());
  end.setDate(last.getDate() + (6 - last.getDay()));

  // Mantém ao menos cinco semanas quando o mês ocupar apenas quatro, evitando que o
  // calendário mude demais de altura entre meses.
  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(isoDateLocal(cursor));
  }
  if (dates.length === 28) {
    const cursor = dateFromISO(dates[dates.length - 1]);
    for (let i = 0; i < 7; i += 1) {
      cursor.setDate(cursor.getDate() + 1);
      dates.push(isoDateLocal(cursor));
    }
  }
  return dates;
}

export function intervalOverlapsMonth(start: string, end: string | undefined, month: Date): boolean {
  const bounds = monthBounds(month);
  return start <= bounds.end && (end ?? start) >= bounds.start;
}
