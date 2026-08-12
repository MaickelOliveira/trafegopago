import { PLATFORM_BASE_URL, CONSENT_VERSION, HEARTBEAT_INTERVAL_MINUTES } from "./config";
import type {
  ConnectorState,
  PopupState,
  StoredAuth,
  ContentToBackgroundMessage,
  PopupToBackgroundMessage,
  BackgroundToPopupMessage,
  ConversationUpdate,
} from "./types";

const ALARM_NAME = "heartbeat";
const STORAGE_AUTH = "auth";
const STORAGE_DEVICE_PUBLIC_ID = "devicePublicId";
const STORAGE_LAST_WHATSAPP_STATE = "lastWhatsappState";
const STORAGE_REVOKED_FLAG = "wasRevoked";

// Estado do popup calculado a partir de storage — service worker MV3 pode
// ser derrubado e reiniciado a qualquer momento, então nada crítico fica só
// em variável de memória sem também estar em chrome.storage.local.

async function getDevicePublicId(): Promise<string> {
  const existing = await chrome.storage.local.get(STORAGE_DEVICE_PUBLIC_ID);
  if (existing[STORAGE_DEVICE_PUBLIC_ID]) return existing[STORAGE_DEVICE_PUBLIC_ID] as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [STORAGE_DEVICE_PUBLIC_ID]: id });
  return id;
}

async function getAuth(): Promise<StoredAuth | null> {
  const data = await chrome.storage.local.get(STORAGE_AUTH);
  return (data[STORAGE_AUTH] as StoredAuth | undefined) ?? null;
}

async function setAuth(auth: StoredAuth | null): Promise<void> {
  if (auth === null) {
    await chrome.storage.local.remove(STORAGE_AUTH);
  } else {
    // storage.local nunca storage.sync — a credencial do dispositivo não deve
    // sincronizar entre navegadores/máquinas do usuário.
    await chrome.storage.local.set({ [STORAGE_AUTH]: auth });
  }
}

async function getLastWhatsappState(): Promise<ConnectorState | null> {
  const data = await chrome.storage.local.get(STORAGE_LAST_WHATSAPP_STATE);
  return (data[STORAGE_LAST_WHATSAPP_STATE] as ConnectorState | undefined) ?? null;
}

async function setLastWhatsappState(state: ConnectorState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LAST_WHATSAPP_STATE]: state });
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_INTERVAL_MINUTES });
  }
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); });

async function sendHeartbeat(connectorState: ConnectorState): Promise<"ok" | "revoked" | "error"> {
  const auth = await getAuth();
  if (!auth) return "error";
  try {
    const res = await fetch(`${PLATFORM_BASE_URL}/api/integrations/whatsapp-extension/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.deviceToken}` },
      body: JSON.stringify({ connectorState }),
    });
    if (res.status === 401) return "revoked";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

async function sendMessageBatch(items: ConversationUpdate[]): Promise<void> {
  const auth = await getAuth();
  if (!auth || items.length === 0) return;
  try {
    const res = await fetch(`${PLATFORM_BASE_URL}/api/integrations/whatsapp-extension/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.deviceToken}` },
      body: JSON.stringify({ items }),
    });
    if (res.status === 401) await handleRevoked();
  } catch {
    // Perde esse lote específico se a rede falhar — próxima mudança de
    // prévia detectada no content script gera um novo lote, não fica preso.
  }
}

async function handleRevoked(): Promise<void> {
  await setAuth(null);
  await chrome.storage.local.set({ [STORAGE_REVOKED_FLAG]: true });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const auth = await getAuth();
  if (!auth) return;
  const state = (await getLastWhatsappState()) ?? "disconnected";
  const result = await sendHeartbeat(state);
  if (result === "revoked") await handleRevoked();
});

async function computePopupState(): Promise<BackgroundToPopupMessage> {
  const auth = await getAuth();
  if (!auth) {
    const revokedData = await chrome.storage.local.get(STORAGE_REVOKED_FLAG);
    if (revokedData[STORAGE_REVOKED_FLAG]) {
      return { type: "status-update", popupState: "device_revoked" };
    }
    return { type: "status-update", popupState: "not_linked" };
  }

  const state = await getLastWhatsappState();
  let popupState: PopupState;
  if (state === "connected") popupState = "platform_connected";
  else if (state === "waiting_qr") popupState = "waiting_connection";
  else popupState = "whatsapp_closed";

  return { type: "status-update", popupState, connectorState: state ?? undefined };
}

async function submitCode(code: string): Promise<BackgroundToPopupMessage> {
  const devicePublicId = await getDevicePublicId();
  try {
    const res = await fetch(`${PLATFORM_BASE_URL}/api/integrations/whatsapp-extension/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, devicePublicId, consentVersion: CONSENT_VERSION }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const reason = data.reason as string | undefined;
      if (reason === "expired") return { type: "status-update", popupState: "expired_code" };
      if (reason === "not_found" || reason === "used") return { type: "status-update", popupState: "invalid_code", errorMessage: data.error };
      return { type: "status-update", popupState: "comm_error", errorMessage: data.error ?? "Erro ao validar código" };
    }

    await setAuth({
      deviceId: data.deviceId,
      deviceToken: data.deviceToken,
      clientId: data.clientId,
      devicePublicId,
    });
    await chrome.storage.local.remove(STORAGE_REVOKED_FLAG);
    await ensureAlarm();
    return { type: "status-update", popupState: "open_whatsapp" };
  } catch {
    return { type: "status-update", popupState: "comm_error", errorMessage: "Não foi possível falar com a plataforma. Verifique sua conexão." };
  }
}

async function disconnect(): Promise<BackgroundToPopupMessage> {
  await setAuth(null);
  return { type: "status-update", popupState: "not_linked" };
}

chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage | PopupToBackgroundMessage, _sender, sendResponse) => {
  if (message.type === "whatsapp-state") {
    (async () => {
      await setLastWhatsappState(message.state);
      const auth = await getAuth();
      if (auth) {
        // Reporta imediatamente na mudança de estado, sem esperar o próximo
        // alarme — o alarme cobre o caso de nada mudar por um tempo.
        const result = await sendHeartbeat(message.state);
        if (result === "revoked") await handleRevoked();
      }
    })();
    return false;
  }

  if (message.type === "new-messages") {
    sendMessageBatch(message.items);
    return false;
  }

  if (message.type === "get-status") {
    computePopupState().then(sendResponse);
    return true; // resposta assíncrona
  }

  if (message.type === "submit-code") {
    submitCode(message.code).then(sendResponse);
    return true;
  }

  if (message.type === "disconnect") {
    disconnect().then(sendResponse);
    return true;
  }

  return false;
});
