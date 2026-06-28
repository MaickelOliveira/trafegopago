/** Converte um preset de data no estilo Meta (last_30d, this_month, ...) em since/until
 *  explícitos (YYYY-MM-DD). Usado pelas rotas do Google Ads, que (diferente da Meta)
 *  não têm um equivalente de "date_preset" embutido na API — só BETWEEN since/until. */
export function datePresetToRange(preset: string): { since: string; until: string } {
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const today = new Date();
  const until = fmt(today);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return fmt(d);
  };

  switch (preset) {
    case "today":
      return { since: until, until };
    case "yesterday": {
      const d = daysAgo(1);
      return { since: d, until: d };
    }
    case "last_7d":
      return { since: daysAgo(7), until };
    case "last_14d":
      return { since: daysAgo(14), until };
    case "last_30d":
      return { since: daysAgo(30), until };
    case "this_month":
      return { since: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), until };
    case "last_month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { since: fmt(first), until: fmt(last) };
    }
    case "maximum":
      // GAQL não tem equivalente de "todo o período" — aproxima com uma janela larga.
      return { since: daysAgo(365 * 3), until };
    default:
      return { since: daysAgo(30), until };
  }
}
