import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getConfig, patchClient } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import { getGoogleAdsCreds } from "@/lib/google-ads-creds";
import { formatGoogleAdsError } from "@/lib/google-ads-api";
import { hasGoogleConversionAuthorization } from "@/lib/google-conversion-auth";
import { googleConversionHistory } from "@/lib/google-conversion-outbox";
import { inspectGoogleConversionActions, prepareGoogleConversionActions } from "@/lib/google-conversion-api";
import { GoogleConversionInputError, ownedGoogleConversionAccount, validateGoogleConversionSettings } from "@/lib/google-conversion-settings";
import { allowLoginAttempt } from "@/lib/auth-rate-limit";
import { databasePool, withDataTransaction } from "@/lib/document-store";
type Context = { params: Promise<{ clientId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const { clientId } = await context.params;
  const client = await getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  return NextResponse.json({ settings: client.googleConversions || null, authorized: hasGoogleConversionAuthorization(await getConfig()), accounts: client.adAccounts.filter(account => account.platform === "google"), funnels: (await getFunnels()).filter(funnel => funnel.clientId === clientId).map(funnel => ({ id: funnel.id, name: funnel.name, columns: funnel.columns.map(column => ({ id: column.id, label: column.label })) })), ...await googleConversionHistory(clientId) });
}
async function contextForChange(context: Context) {
  const session = await getSession();
  if (session?.role !== "manager") return { response: NextResponse.json({ error: "Acesso não permitido." }, { status: 403 }) };
  const { clientId } = await context.params;
  const client = await getClientById(clientId);
  if (!client) return { response: NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 }) };
  if (!await allowLoginAttempt(`google-conversions:${session.sub}:${clientId}`)) return { response: NextResponse.json({ error: "Aguarde alguns minutos antes de tentar novamente." }, { status: 429 }) };
  return { client };
}
export async function POST(request: NextRequest, context: Context) {
  const checked = await contextForChange(context);
  if (checked.response) return checked.response;
  const lock = await databasePool().connect();
  let locked = false;
  try {
    const body = await request.json();
    const accountId = ownedGoogleConversionAccount(checked.client, body?.accountId);
    const creds = await getGoogleAdsCreds();
    if (!creds) throw new GoogleConversionInputError("Conecte os anúncios Google da Nexo antes de preparar as ações.");
    locked = !!(await lock.query("SELECT pg_try_advisory_lock(721461,4) AS locked")).rows[0].locked;
    if (!locked) return NextResponse.json({ error: "Outra preparação está em andamento. Aguarde." }, { status: 409 });
    return NextResponse.json(await prepareGoogleConversionActions(creds,accountId));
  } catch (error) { return NextResponse.json({ error: error instanceof GoogleConversionInputError ? error.message : formatGoogleAdsError(error) }, { status: 400 }); }
  finally { if (locked) await lock.query("SELECT pg_advisory_unlock(721461,4)").catch(() => {}); lock.release(); }
}
export async function PUT(request: NextRequest, context: Context) {
  const checked = await contextForChange(context);
  if (checked.response) return checked.response;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new GoogleConversionInputError("Configuração inválida.");
    if (body.enabled === false) {
      await withDataTransaction(async () => {
        const current = await getClientById(checked.client.id);
        if (current?.googleConversions) await patchClient(current.id,{googleConversions:{...current.googleConversions,enabled:false}});
      });
      return NextResponse.json({ ok: true, enabled: false });
    }
    if (!hasGoogleConversionAuthorization(await getConfig())) throw new GoogleConversionInputError("Autorize o envio de conversões para a Nexo antes de ativar.");
    const accountId = ownedGoogleConversionAccount(checked.client,body.accountId);
    const creds = await getGoogleAdsCreds();
    if (!creds) throw new GoogleConversionInputError("Conecte os anúncios Google da Nexo.");
    const inspection = await inspectGoogleConversionActions(creds,accountId);
    await withDataTransaction(async () => {
      const current = await getClientById(checked.client.id);
      if (!current) throw new GoogleConversionInputError("Cliente não encontrado.");
      const settings = validateGoogleConversionSettings(current,body,await getFunnels(),inspection);
      await patchClient(current.id,{googleConversions:settings});
    });
    return NextResponse.json({ ok: true, enabled: true });
  } catch(error) { return NextResponse.json({ error: error instanceof GoogleConversionInputError ? error.message : formatGoogleAdsError(error) }, { status: 400 }); }
}
