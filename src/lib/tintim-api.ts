const BASE = "https://s.tintim.app/api/v1";

export type TintimLeadStatus = {
  id: number;
  name: string;
  type: string;
  color?: string;
};

export type TintimLead = {
  phone: string;
  name: string | null;
  status: TintimLeadStatus | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  sale_amount: number | null;
  created_at: string | null;
};

export async function getLeadData(
  phone: string,
  code: string,
  token: string
): Promise<TintimLead | null> {
  const res = await fetch(`${BASE}/${code}/lead/${phone}?token=${token}`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getLeadStatuses(
  code: string,
  token: string
): Promise<TintimLeadStatus[]> {
  const res = await fetch(`${BASE}/${code}/leadstatus?token=${token}`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  return res.json();
}
