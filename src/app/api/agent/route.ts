import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getAgentConfigForConnection, getAllAgentConfigs, upsertAgentConfigForConnection, type AgentConfig } from "@/lib/clients";
import { withDataTransaction } from "@/lib/document-store";
import { getFunnelForConnection } from "@/lib/lead-context";
import { cancelFollowUpsForConnection, cancelFollowUpsForPhone } from "@/lib/followups";
import { sanitizeAgentPhoneList } from "@/lib/agent-phone-policy";
async function context(req: NextRequest) {
  if ((await getSession())?.role !== "manager") return null;
  const id = req.nextUrl.searchParams.get("clientId"); if (!id) return null;
  const client = await getClientById(id); if (!client) return null;
  const connId = req.nextUrl.searchParams.get("connId") || undefined;
  if (connId && !await getFunnelForConnection(id, connId)) return null;
  const configs = getAllAgentConfigs(client);
  const current = connId ? getAgentConfigForConnection(client, connId) : configs.length === 1 ? configs[0] : client.agentConfig;
  if (!connId && configs.length > 1) return null;
  const selected=connId||current?.whatsappConnectionId;
  if(selected&&!await getFunnelForConnection(id,selected))return null;
  return { client, connId: connId || current?.whatsappConnectionId, current: current ?? { enabled: false, followUpEnabled: false, followUps: [] } };
}
export async function GET(req: NextRequest) {
  const ctx = await context(req); if (!ctx) return NextResponse.json({ error: "Selecione um cliente e uma conexão permitida." }, { status: 403 });
  const { current } = ctx;
  return NextResponse.json({ ...current, geminiApiKey: "", hasGeminiKey: !!current.geminiApiKey, googleRefreshToken: undefined, calendarConnected: !!current.googleRefreshToken, _agentConfigsSummary: getAllAgentConfigs(ctx.client).map(config => ({ whatsappConnectionId: config.whatsappConnectionId, enabled: config.enabled, followUpEnabled: config.followUpEnabled, name: config.name })) });
}
async function update(req: NextRequest, toggle: boolean) {
  if ((await getSession())?.role !== "manager") return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || JSON.stringify(body).length > 2 * 1024 * 1024) return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  if (toggle && (!["enabled", "followUpEnabled"].includes(body.field) || typeof body.value !== "boolean")) return NextResponse.json({ error: "Opção inválida." }, { status: 400 });
  for (const key of ["enabled", "followUpEnabled", "splitMessages", "dailySummaryEnabled", "aiAutoResumeEnabled", "greetingOnlyMode", "businessHoursEnabled"]) if (!toggle && body[key] !== undefined && typeof body[key] !== "boolean") return NextResponse.json({ error: "Opção inválida." }, { status: 400 });
  if (!toggle && body.followUps !== undefined && (!Array.isArray(body.followUps) || body.followUps.length > 50 || body.followUps.some((step: { id?: unknown; delayHours?: unknown; message?: unknown }) => typeof step.id !== "string" || typeof step.delayHours !== "number" || !Number.isFinite(step.delayHours) || step.delayHours < 0 || typeof step.message !== "string"))) return NextResponse.json({ error: "Confira os passos de follow-up." }, { status: 400 });
  return withDataTransaction(async () => {
    const ctx = await context(req); if (!ctx) return NextResponse.json({ error: "Selecione um cliente e uma conexão permitida." }, { status: 403 });
    const { client, current, connId } = ctx;
    const patch = toggle ? { [body.field]: body.value } : body;
    const updated: AgentConfig = { ...current, ...patch, googleRefreshToken: current.googleRefreshToken, dailySummaryLastSentDate: current.dailySummaryLastSentDate, geminiApiKey: patch.geminiApiKey || current.geminiApiKey, whatsappConnectionId: connId, ignoredPhones: patch.ignoredPhones === undefined ? current.ignoredPhones : sanitizeAgentPhoneList(patch.ignoredPhones) };
    await upsertAgentConfigForConnection(client, connId, updated);
    if (!updated.followUpEnabled || !updated.followUps?.length) await cancelFollowUpsForConnection(client.id, connId);
    for (const phone of updated.ignoredPhones ?? []) await cancelFollowUpsForPhone(client.id, phone, connId);
    return NextResponse.json({ ok: true, ...(toggle ? { [body.field]: body.value } : {}) });
  });
}
export async function PUT(req: NextRequest) { return update(req, false); }
export async function PATCH(req: NextRequest) { return update(req, true); }
