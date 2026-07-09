import crypto from "crypto";
import { getConfig } from "./clients";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export async function sendCapiEvent(opts: {
  pixelId: string;
  capiToken?: string; // Token de Conversão da API (por cliente) — prioritário sobre o token global
  testEventCode?: string; // Código da aba "Testar eventos" do Gerenciador de Eventos — só usar durante testes
  eventName: string;
  phone?: string;
  email?: string;
  name?: string;      // Nome do lead — vira fn/ln (primeiro nome / sobrenome), ambos hasheados
  fbclid?: string;     // ID de clique do Meta Ads salvo no lead — vira o parâmetro fbc
  fbp?: string;             // Cookie _fbp capturado no site — NÃO é hasheado
  clientIp?: string;        // IP real capturado na criação do lead — NÃO é hasheado
  clientUserAgent?: string; // User-Agent real capturado na criação do lead — NÃO é hasheado
  externalId?: string;
  value?: number;
  currency?: string;
}): Promise<void> {
  // Usa token de conversão do cliente se disponível, senão o token global
  const token = opts.capiToken || getConfig().metaToken;
  if (!token || !opts.pixelId) {
    console.warn(`[Meta CAPI] evento "${opts.eventName}" NÃO enviado — faltando ${!token ? "token (capiToken do cliente e metaToken global vazios)" : "pixelId"}`);
    return;
  }

  const userData: Record<string, string> = {};
  if (opts.phone) {
    // A Meta exige o telefone COM código do país (sem "+") pra hashear — o
    // telefone salvo no lead vem normalizado SEM o "55" (formato usado nas
    // buscas internas de conversa), então precisa recolocar aqui antes do hash.
    const digits = opts.phone.replace(/\D/g, "");
    const withCountryCode = digits.startsWith("55") ? digits : `55${digits}`;
    userData.ph = sha256(withCountryCode);
  }
  if (opts.email) userData.em = sha256(opts.email);
  if (opts.externalId) userData.external_id = sha256(opts.externalId);
  if (opts.name) {
    const parts = opts.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) userData.fn = sha256(parts[0]);
    if (parts.length > 1) userData.ln = sha256(parts.slice(1).join(" "));
  }
  if (opts.fbclid) {
    // Formato oficial do fbc: fb.1.<timestamp em ms>.<fbclid> — fbc/fbp NÃO são
    // hasheados (diferente de email/telefone/nome, que são PII).
    userData.fbc = `fb.1.${Date.now()}.${opts.fbclid}`;
  }
  if (opts.fbp) userData.fbp = opts.fbp;
  if (opts.clientIp) userData.client_ip_address = opts.clientIp;
  if (opts.clientUserAgent) userData.client_user_agent = opts.clientUserAgent;

  const eventData: Record<string, unknown> = {
    event_name: opts.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "other",
    user_data: userData,
  };
  if (opts.value != null) {
    eventData.custom_data = { currency: opts.currency ?? "BRL", value: opts.value };
  }

  const payload: { data: unknown[]; access_token: string; test_event_code?: string } = {
    data: [eventData],
    access_token: token,
  };
  // .trim() — espaço/quebra de linha invisível colado do Gerenciador de Eventos faz
  // a Meta não reconhecer o código como válido: o evento é aceito normalmente
  // (events_received:1) só que nunca aparece na aba "Testar eventos".
  const testEventCode = opts.testEventCode?.trim();
  if (testEventCode) payload.test_event_code = testEventCode;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${opts.pixelId}/events`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  ).catch((e) => {
    console.error(`[Meta CAPI] fetch falhou (erro de rede) para evento "${opts.eventName}" pixel=${opts.pixelId}:`, e);
    return null;
  });
  if (!res) return;

  // Sempre lê o corpo — a Meta pode responder 200 com events_received:0 e
  // mensagens de aviso quando o evento é rejeitado por validação (ex:
  // test_event_code inválido/expirado, user_data insuficiente), o que antes
  // passava batido como "sucesso" só por checar res.ok.
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    console.error(`[Meta CAPI] resposta com erro (status ${res.status}) para evento "${opts.eventName}" pixel=${opts.pixelId}:`, body);
    return;
  }

  const eventsReceived = (body as { events_received?: number } | null)?.events_received;
  if (eventsReceived === 0) {
    console.warn(`[Meta CAPI] evento "${opts.eventName}" respondeu 200 mas events_received=0 (rejeitado na validação) — pixel=${opts.pixelId}${testEventCode ? ` test_event_code="${testEventCode}"` : ""}:`, body);
  } else {
    console.log(`[Meta CAPI] evento "${opts.eventName}" enviado com sucesso — pixel=${opts.pixelId}${testEventCode ? ` test_event_code="${testEventCode}"` : ""}:`, body);
  }
}
