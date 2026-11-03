// This smoke check is intentionally restricted to the isolated local audit app.
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.AUDIT_BASE_URL || "http://127.0.0.1:3315";
if (!/^http:\/\/127\.0\.0\.1:331[56]$/.test(base) || process.env.TP_BACKGROUND_JOBS_ENABLED !== "false") throw Error("Use somente o ambiente local de auditoria, com os envios desativados.");
const { password } = JSON.parse(await readFile("private/audit-fixtures.json", "utf8"));
const results = [];
async function request(path, expected, cookie, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...(!["GET","HEAD"].includes(options.method || "GET") ? { Origin: base } : {}), ...(cookie ? { cookie } : {}), ...options.headers }, signal: AbortSignal.timeout(90000) });
  if (response.status !== expected) throw Error(`${path}: esperado ${expected}, recebido ${response.status}`);
  results.push({ path, status: response.status }); return response;
}
async function login(email) {
  const response = await request("/api/auth/login", 200, null, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return response.headers.get("set-cookie").split(";")[0];
}
await request("/api/crm/leads", 401);
await request("/api/gestor/clients", 401);
await request("/api/debug/leads", 404);
await request("/api/pousada/reservas", 410);
await request("/api/guest-forms/retired", 410);
await request("/api/servico-forms/retired", 410);
await request("/api/whatsapp/webhook", 410, null, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
for(const path of ["/api/whatsapp/manager","/api/whatsapp/wppconnect-manager","/api/whatsapp/webhook/wppconnect/old","/api/integrations/whatsapp-extension/messages","/api/integrations/whatsapp-server","/api/conectar/old"])await request(path,410);
const manager = await login("gestor@example.invalid"), client = await login("audit-a@example.invalid"), employee = await login("atendente@example.invalid");
await request("/api/gestor/config", 403, client);
await request("/api/campaigns",410,client);
await request("/api/not-a-feature",403,client);
await request("/api/crm/not-a-feature",403,client);
await request("/api/google-ads/2222222222/campaigns",403,client);
await request("/api/google-ads/1234567890/campaigns",500,client);
await request("/api/google-ads/1234567890/campaigns",403,employee);
await request("/api/crm/leads/lead-b", 403, client);
await request("/api/crm/leads?clientId=audit-b", 403, client);
await request("/api/crm/automations/auto-b", 403, client, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "must not change" }) });
await request("/api/crm/automations", 403, employee);
await request("/api/crm/leads/lead-a", 403, employee, { method: "DELETE" });
const own = await request("/api/crm/leads", 200, client); const leads = await own.json();
if (!Array.isArray(leads) || leads.some(item => item.clientId !== "audit-a")) throw Error("Lista de leads fora do cliente.");
await request("/api/gestor/config", 403, manager, { method: "PUT", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{}" });
const config = await (await request("/api/gestor/config", 200, manager)).json();
if (config.manager || config.googleAdsRefreshToken || config.metaToken) throw Error("Configuração expôs dados sensíveis.");
await request("/api/gestor/clients/audit-a", 400, manager, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "short" }) });
await request("/api/gestor/clients", 400, manager, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Same name", email: "audit-a@example.invalid", password: "synthetic-password-123" }) });
await writeFile("private/api-smoke-results.json", JSON.stringify({ syntheticOnly: true, externalMessagesSent: false, results }, null, 2));
console.log(JSON.stringify({ passed: results.length, clientIsolation: true, csrf: true, noExternalMessages: true }));
