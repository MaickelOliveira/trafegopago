export function ownsAdAccount(accounts: { id: string; platform: string }[], platform: "meta" | "google", accountId: string): boolean {
  const normalize = (value: string) => platform === "meta" ? value.replace(/^act_/, "") : value.replace(/-/g, "");
  if (!/^(?:act_)?\d+$/.test(accountId)) return false;
  return accounts.some(account => account.platform === platform && normalize(account.id) === normalize(accountId));
}

/** A caller must not hide another account's campaign behind an owned account ID. */
export async function metaObjectBelongsToAccount(objectId: string, accountId: string, token: string): Promise<boolean> {
  if (!/^\d+$/.test(objectId) || !/^(?:act_)?\d+$/.test(accountId) || !token) return false;
  try {
    const response = await fetch(`https://graph.facebook.com/v26.0/${objectId}?fields=account_id`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) return false;
    const body = await response.json();
    return typeof body.account_id === "string" && body.account_id.replace(/^act_/, "") === accountId.replace(/^act_/, "");
  } catch { return false; }
}
