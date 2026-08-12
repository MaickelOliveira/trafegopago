// Tipos e constantes compartilhados entre server (API routes, módulos com
// `fs`) e client components — nunca importar `extension-devices.ts` ou
// `extension-pairing-codes.ts` diretamente de um componente client, só este
// arquivo (mesma convenção de `sales-types.ts`/`financeiro-types.ts`).

export type ExtensionConnectorState = "connected" | "waiting_qr" | "disconnected";

// 2.0.0: extensão passou a ler nome de contato + prévia de mensagem pra
// criar leads no CRM (antes só reportava status de conexão) — quem já tinha
// aceitado a v1.0.0 precisa re-consentir (claim rejeita versão desatualizada).
export const EXTENSION_CONSENT_VERSION = "2.0.0";

export type DeviceStatusView = {
  id: string;
  devicePublicId: string;
  connectorState: ExtensionConnectorState;
  lastSeenAt: string;
  createdAt: string;
  // Só presentes quando quem pediu é o gestor (ver /api/integrations/whatsapp-extension/status) —
  // a visão do próprio cliente não precisa disso, já sabe de quem é.
  clientId?: string;
  clientName?: string;
};
