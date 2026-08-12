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

export type ConversationUpdate = {
  phone: string | null;
  contactName: string | null;
  lastMessagePreview: string | null;
};

/** Mensagens trocadas entre content-script → service-worker. O content script
 *  nunca fala direto com o backend — só relata o que vê na página, o service
 *  worker decide o que fazer com isso (rate limit, retry, etc. ficam
 *  centralizados em um lugar só). */
export type ContentToBackgroundMessage =
  | { type: "whatsapp-state"; state: ConnectorState }
  | { type: "new-messages"; items: ConversationUpdate[] };

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
