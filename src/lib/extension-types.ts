// Tipos e constantes compartilhados entre server (API routes, módulos com
// `fs`) e client components — nunca importar `extension-devices.ts` ou
// `extension-pairing-codes.ts` diretamente de um componente client, só este
// arquivo (mesma convenção de `sales-types.ts`/`financeiro-types.ts`).

export type ExtensionConnectorState = "connected" | "waiting_qr" | "disconnected";

// 3.0.0: extensão passou a ler o estado interno do próprio WhatsApp Web
// (via lib de terceiros injetada na página, técnica não-oficial — mesma
// categoria de risco de Evolution/WPPConnect, mas agora recaindo sobre o
// WhatsApp PESSOAL do cliente, não um número dedicado) pra capturar o
// contexto de anúncio (campanha/anúncio de origem) de mensagens vindas de
// clique em anúncio — antes disso, o texto/nome já lidos vinham só do DOM
// visível. Quem já tinha aceitado a v2.0.0 precisa re-consentir.
export const EXTENSION_CONSENT_VERSION = "3.0.0";

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
  // Funil de CRM vinculado — SEMPRE atribuído pelo gestor depois da conexão
  // técnica existir (mesmo padrão de Evolution/UazAPI/WPPConnect, nunca pelo
  // próprio cliente no momento de gerar o código).
  funnelId?: string;
  funnelName?: string;
};
