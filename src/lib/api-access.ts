import {getAllConversationsByClientId} from "./conversations";
import { isRetiredApiPath } from "./retired-systems";
import { getFunnelForConnection } from "./lead-context";
import { authorizeWhatsAppWebhook } from "./webhook-auth";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestSession } from "./auth";
import { getLeadById } from "./leads";
import { getFunnels, getFunnelById } from "./funnels";
import { getCreativeById } from "./creatives";
import { getAutomationById } from "./crm-automations";
import { getBroadcastById } from "./broadcasts";
import { getWebhookById } from "./webhooks";
import { getEmployeeById, employeeCanAccessFunnel, DEFAULT_PERMISSIONS, type EmployeePermissions } from "./employees";
import { getTemplateById } from "./waba-templates";
import { getClientById } from "./clients";
import { ownsAdAccount } from "./ad-account-access";
import { verifyAdAssetAccess } from "./ad-media-access";

const publicPaths = [
  /^\/api\/health$/,
  /^\/api\/auth\/(login|logout)$/,
  /^\/api\/(briefing)\/[^/]+$/,
  /^\/api\/conectar-evolution\/[^/]+(?:\/(?:connect|status))?$/,
  /^\/api\/wh\/[^/]+$/,
  /^\/api\/pixel(?:\/[^/]+)?$/,
  /^\/api\/wa-redirect$/,
  /^\/api\/crm\/webhook\/form$/,
  /^\/api\/whatsapp\/(?:meta|webhook\/evolution\/[^/]+)$/,
  /^\/api\/meta\/webhook$/,
  /^\/api\/(?:agent\/cron|cron\/daily)$/,
  // These files are also fetched by WhatsApp providers. Their file handlers
  // validate signed URLs or the logged-in owner, separately from cookie auth.
  /^\/api\/(media|uploads)\/[^/]+$/,
];

export function isPublicApi(pathname: string): boolean {
  return publicPaths.some(pattern => pattern.test(pathname));
}

/** Explicit tenant surfaces. New APIs are unavailable to non-managers until scoped. */
export function isTenantApiPath(pathname:string):boolean {
 return [
  /^\/api\/cliente\/(?:my-settings|change-request|connection-(?:status|metrics|qr)|checklist(?:\/[^/]+)?|employees(?:\/[^/]+)?)$/,
  /^\/api\/crm\/(?:connections|funnels(?:\/[^/]+)?|leads(?:\/[^/]+(?:\/(?:analyze|followups))?)?|conversations\/[^/]+|automations(?:\/[^/]+)?|webhooks(?:\/[^/]+)?|import|reset-ai-context|kanban-agent)$/,
  /^\/api\/(?:quick-replies|creatives|broadcasts)(?:\/[^/]+)?$/,
  /^\/api\/creatives\/[^/]+\/(?:comment|status)$/,
  /^\/api\/waba\/(?:connections|send|profile-photo|templates(?:\/[^/]+)?)$/,
  /^\/api\/whatsapp\/inbox\/(?:conversations|messages|send|send-template|ai-pause|read)$/,
  /^\/api\/upload$/,
 ].some(pattern=>pattern.test(pathname));
}

function denied(status = 403) {
  return NextResponse.json({ error: status === 401 ? "Entre na sua conta para continuar." : "Acesso não permitido." }, { status });
}

const managerOnly = /^\/api\/(?:admin|debug|gestor|financeiro|social|google-ads|meta|whatsapp\/(?:manager|wppconnect-manager|evolution-manager|meta-manager))(?:\/|$)/;

function requiredEmployeePermission(path: string, method: string): keyof EmployeePermissions | undefined {
  if (/^\/api\/(?:agent(?:\/|$)|crm\/kanban-agent)/.test(path)) return "canViewAgentIa";
  if (/^\/api\/crm\/automations/.test(path)) return "canViewAutomations";
  if (/^\/api\/creatives/.test(path)) return "canViewCreatives";
  if (/^\/api\/(?:waba|broadcasts)/.test(path)) return "canViewWaba";
  if (/^\/api\/cliente\/connection/.test(path) && method !== "GET") return "canManageQR";
  if (/^\/api\/(?:whatsapp\/inbox\/(?:send|send-template|ai-pause)|crm\/conversations\/)/.test(path) && method !== "GET") return "canManageLeadMessages";
  if ((/^\/api\/crm\/reset-ai-context$/.test(path)||/^\/api\/crm\/leads\/[^/]+\/followups$/.test(path)) && method!=="GET")return "canManageLeadMessages";
  if (/^\/api\/crm\/leads\//.test(path) && method === "DELETE") return "canDeleteLeads";
  return undefined;
}

/** Runs for every API request, including APIs that previously had no session check. */
export async function authorizeApi(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (isRetiredApiPath(pathname)) return NextResponse.json({ error: "Este recurso foi desativado." }, { status: 410 });
  if (/^\/api\/(?:admin|debug)(?:\/|$)/.test(pathname) && process.env.ENABLE_DIAGNOSTIC_ROUTES !== "true") {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }
  if (/^\/api\/whatsapp\/webhook(?:\/[^/]+){0,2}$/.test(pathname) && request.method !== "OPTIONS" && !authorizeWhatsAppWebhook(request)) return denied();
  if (isPublicApi(pathname)) return null;
  const session = await getRequestSession(request);
  if (!session) return denied(401);
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (unsafe) {
    const origin = request.headers.get("origin");
    const configured = process.env.APP_BASE_URL;
    const allowed = new Set([request.nextUrl.origin, ...(configured ? [new URL(configured).origin] : [])]);
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && !allowed.has(origin))) return denied();
  }
  if (session.role === "manager") return null;
  const adAsset = pathname.match(/^\/api\/meta\/(ig|video)\/(\d+)$/);
  if (adAsset && request.method === "GET") {
    if (session.role !== "client" || !verifyAdAssetAccess(request.nextUrl,adAsset[1] as "ig"|"video",adAsset[2],session.clientId!)) return denied();
    const client=await getClientById(session.clientId!);
    return client && ownsAdAccount(client.adAccounts,"meta",request.nextUrl.searchParams.get("accountId")!) ? null : denied();
  }
  const accountRead = pathname.match(/^\/api\/(meta|google-ads)\/((?:act_)?\d+)\/(?:campaigns(?:\/\d+\/adsets(?:\/\d+\/ads)?)?|insights)$/);
  if (accountRead && request.method === "GET") {
    if (session.role !== "client") return denied();
    const client = await getClientById(session.clientId!);
    return client && ownsAdAccount(client.adAccounts,accountRead[1] === "meta" ? "meta" : "google",accountRead[2]) ? null : denied();
  }
  if (managerOnly.test(pathname) || /^\/api\/cliente\/employees/.test(pathname) && session.role === "employee") return denied();
  const employee = session.role === "employee" ? await getEmployeeById(session.employeeId!) : undefined;
  const permission = requiredEmployeePermission(pathname, request.method);
  if(!isTenantApiPath(pathname))return denied();
  if(employee && unsafe && /^\/api\/(?:broadcasts(?:\/|$)|waba\/send$)/.test(pathname) && !(employee.permissions?.canManageLeadMessages??DEFAULT_PERMISSIONS.canManageLeadMessages))return denied();
  if (employee && unsafe && (pathname === "/api/crm/kanban-agent" || pathname.startsWith("/api/crm/funnels") || pathname.startsWith("/api/waba/templates"))) return denied();
  if (employee && permission && !(employee.permissions?.[permission] ?? DEFAULT_PERMISSIONS[permission])) return denied();

  let body: Record<string, unknown> = {};
  if (unsafe && request.headers.get("content-type")?.includes("application/json")) {
    try {
      const parsed = await request.clone().json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return denied();
      body = parsed;
    } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  }
  const scope = session.clientId!;
  for (const clientId of [request.nextUrl.searchParams.get("clientId"), body.clientId]) {
    if (clientId != null && clientId !== scope) return denied();
  }
  const canAccessFunnel = async (id: string) => {
    const funnel = await getFunnelById(id);
    return !!funnel && funnel.clientId === scope && (!employee || employeeCanAccessFunnel(employee, id));
  };
  for (const funnelId of [body.funnelId, request.nextUrl.searchParams.get("funnelId")]) {
    if (funnelId != null && (typeof funnelId !== "string" || !await canAccessFunnel(funnelId))) return denied();
  }
  if (employee && unsafe && pathname === "/api/waba/send" && !body.funnelId) return denied();
  if (employee && unsafe && pathname === "/api/crm/automations" && !body.funnelId) return denied();
  if (body.templateId !== undefined) {
    if (typeof body.templateId !== "string") return denied();
    const template = await getTemplateById(body.templateId);
    if (!template || template.clientId !== scope) return denied();
    if (employee) { const owned = (await getFunnels()).filter(funnel => funnel.clientId === scope && employeeCanAccessFunnel(employee, funnel.id)); if (!owned.some(funnel => funnel.connections?.some(connection => connection.type === "meta" && connection.metaPhoneNumberId === template.phoneNumberId))) return denied(); }
  }
  const connectionId = body.connId ?? body.connectionId ?? request.nextUrl.searchParams.get("connId");
  if (employee && /^\/api\/(?:whatsapp\/inbox\/(?!conversations)|crm\/conversations\/)/.test(pathname) && !connectionId && !body.funnelId && !request.nextUrl.searchParams.has("funnelId")) return denied();
  if (connectionId != null) {
    if (typeof connectionId !== "string") return denied();
    const funnel = await getFunnelForConnection(scope, connectionId);
    const archivedRead=!employee && request.method==="GET" && /^\/api\/crm\/conversations\//.test(pathname) && (await getAllConversationsByClientId(scope)).some(conversation=>conversation.connId===connectionId);
    if ((!funnel || !await canAccessFunnel(funnel.id)) && !archivedRead) return denied();
  }
  const match = pathname.match(/^\/api\/(crm\/leads|crm\/funnels|crm\/automations|crm\/webhooks|creatives|broadcasts|waba\/templates)\/([^/]+)/);
  if (match && !["bulk", "import"].includes(match[2])) {
    const [type, id] = match.slice(1);
    const item = type === "crm/leads" ? await getLeadById(id) : type === "crm/funnels" ? await getFunnelById(id) : type === "crm/automations" ? await getAutomationById(id) : type === "crm/webhooks" ? await getWebhookById(id) : type === "creatives" ? await getCreativeById(id) : type === "broadcasts" ? await getBroadcastById(id) : await getTemplateById(id);
    if (!item || item.clientId !== scope) return denied();
    if (employee && "connectionId" in item && typeof item.connectionId === "string") { const source = await getFunnelForConnection(scope, item.connectionId); if (!source || !employeeCanAccessFunnel(employee, source.id)) return denied(); }
    if (employee && "funnelId" in item && typeof item.funnelId === "string" && !employeeCanAccessFunnel(employee, item.funnelId)) return denied();
  }
  if (request.method === "GET" && !request.nextUrl.searchParams.has("clientId")) {
    const url = request.nextUrl.clone();
    url.searchParams.set("clientId", scope);
    return NextResponse.rewrite(url);
  }
  return null;
}
