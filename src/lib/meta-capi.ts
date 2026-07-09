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
  if (opts.phone) userData.ph = sha256(opts.phone.replace(/\D/g, ""));
  if (opts.email) userData.em = sha256(opts.email);
  if (opts.externalId) userData.external_id = sha256(opts.externalId);

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
  if (opts.testEventCode) payload.test_event_code = opts.testEventCode;

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
    console.warn(`[Meta CAPI] evento "${opts.eventName}" respondeu 200 mas events_received=0 (rejeitado na validação) — pixel=${opts.pixelId}${opts.testEventCode ? ` test_event_code=${opts.testEventCode}` : ""}:`, body);
  } else {
    console.log(`[Meta CAPI] evento "${opts.eventName}" enviado com sucesso — pixel=${opts.pixelId}${opts.testEventCode ? ` test_event_code=${opts.testEventCode}` : ""}:`, body);
  }
}
