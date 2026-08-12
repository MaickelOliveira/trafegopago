// Tipos e constantes compartilhados entre server (API routes, módulos com
// `fs`) e client components — nunca importar `extension-devices.ts` ou
// `extension-pairing-codes.ts` diretamente de um componente client, só este
// arquivo (mesma convenção de `sales-types.ts`/`financeiro-types.ts`).

export type ExtensionConnectorState = "connected" | "waiting_qr" | "disconnected";

export const EXTENSION_CONSENT_VERSION = "1.0.0";

export type DeviceStatusView = {
  id: string;
  devicePublicId: string;
  connectorState: ExtensionConnectorState;
  lastSeenAt: string;
  createdAt: string;
};
