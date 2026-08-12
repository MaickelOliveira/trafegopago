// Fonte única do domínio de produção — se mudar, atualizar aqui E em
// manifest.json (host_permissions), os dois precisam bater.
export const PLATFORM_BASE_URL = "https://trafegopago-trafegopago.ztcjzs.easypanel.host";

export const CONSENT_VERSION = "1.0.0";

// chrome.alarms trava período mínimo em 1 minuto pra extensões publicadas
// (empacotadas) — não dá pra ir mais rápido que isso de forma confiável em
// produção, então o heartbeat é a cada 1 min. STALE_AFTER_MS no backend
// (src/lib/extension-devices.ts) precisa ficar folgado o suficiente pra
// tolerar 1 heartbeat perdido sem marcar "desconectado" à toa.
export const HEARTBEAT_INTERVAL_MINUTES = 1;
