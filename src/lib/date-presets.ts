/** Converte um preset de data no estilo Meta (last_30d, this_month, ...) em since/until
 *  explícitos (YYYY-MM-DD). Usado pelas rotas do Google Ads, que (diferente da Meta)
 *  não têm um equivalente de "date_preset" embutido na API — só BETWEEN since/until. */
export function datePresetToRange(preset: string): { since: string; until: string } {
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  // Calendar dates are based on the platform's Brazilian operating day, even
  // when the server runs in UTC. UTC dates below only perform calendar math.
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part=(type:string)=>Number(parts.find(item=>item.type===type)!.value);
  const today = new Date(Date.UTC(part("year"),part("month")-1,part("day")));
  const until = fmt(today);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
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
      return { since: daysAgo(6), until };
    case "last_14d":
      return { since: daysAgo(13), until };
    case "last_30d":
      return { since: daysAgo(29), until };
    case "this_month":
      return { since: fmt(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), until };
    case "last_month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { since: fmt(first), until: fmt(last) };
    }
    case "maximum":
      // GAQL não tem equivalente de "todo o período" — aproxima com uma janela larga.
      return { since: daysAgo(365 * 3), until };
    default:
      return { since: daysAgo(29), until };
  }
}
