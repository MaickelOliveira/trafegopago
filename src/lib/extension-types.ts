// Tipos e constantes compartilhados entre server (API routes, módulos com
// `fs`) e client components — nunca importar `extension-devices.ts` ou
// `extension-pairing-codes.ts` diretamente de um componente client, só este
// arquivo (mesma convenção de `sales-types.ts`/`financeiro-types.ts`).

export type ExtensionConnectorState = "connected" | "waiting_qr" | "disconnected";

// 4.0.0: extensão passou a poder ENVIAR mensagem — resposta automática do
// Agente IA, entregue via a mesma técnica não-oficial (@wppconnect/wa-js) já
// usada pra leitura. Diferente de leitura passiva, ENVIO automatizado é
// exatamente o padrão que sistemas de detecção de bot do WhatsApp mais
// observam — risco de restrição/banimento mais sério, ainda recaindo sobre o
// WhatsApp pessoal do cliente. Quem já tinha aceitado a v3.0.0 (só leitura)
// precisa re-consentir.
export const EXTENSION_CONSENT_VERSION = "4.0.0";

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
  // Agente IA vinculado a este dispositivo (client.agentConfig(s).whatsappConnectionId
  // === device.id) — mesmo papel de EnrichedEvolutionSession.hasAgentLinked/agentEnabled.
  hasAgentLinked?: boolean;
  agentEnabled?: boolean;
};
