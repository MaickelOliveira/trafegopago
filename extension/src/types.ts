export type ConnectorState = "connected" | "waiting_qr" | "disconnected";

/** Estados exibidos no popup — cobre o fluxo completo do pedido original. */
export type PopupState =
  | "not_linked"
  | "enter_code"
  | "validating"
  | "open_whatsapp"
  | "waiting_connection"
  | "whatsapp_connected"
  | "platform_connected"
  | "whatsapp_closed"
  | "invalid_code"
  | "expired_code"
  | "device_revoked"
  | "comm_error";

export type StoredAuth = {
  deviceId: string;
  deviceToken: string;
  clientId: string;
  devicePublicId: string;
};

/** Uma mensagem real (não uma "prévia" raspada do DOM) — vem do main-world.ts,
 *  que lê o estado interno já decodificado do WhatsApp Web via @wppconnect/wa-js.
 *  adId/adSourceUrl/adTitle só vêm preenchidos quando a mensagem se originou de
 *  um clique em anúncio (contexto nunca exposto no DOM visível). */
export type IncomingMessage = {
  phone: string;
  contactName: string | null;
  body: string;
  ts: number;
  adId: string | null;
  adSourceUrl: string | null;
  adTitle: string | null;
};

/** Mensagens trocadas entre content-script → service-worker. O content script
 *  nunca fala direto com o backend — só relata o que vê na página, o service
 *  worker decide o que fazer com isso (rate limit, retry, etc. ficam
 *  centralizados em um lugar só). */
export type ContentToBackgroundMessage =
  | { type: "whatsapp-state"; state: ConnectorState }
  | { type: "new-messages"; items: IncomingMessage[] };

/** Mensagens trocadas entre popup ↔ service-worker. */
export type PopupToBackgroundMessage =
  | { type: "get-status" }
  | { type: "submit-code"; code: string }
  | { type: "disconnect" };

export type BackgroundToPopupMessage = {
  type: "status-update";
  popupState: PopupState;
  connectorState?: ConnectorState;
  errorMessage?: string;
};
