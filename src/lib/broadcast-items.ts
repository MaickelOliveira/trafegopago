// Fila de destinatários de um disparo em massa (Broadcast). Mesmo formato
// flat-array + claim atômico de followups.ts — sobrevive a restart do
// processo, diferente de um setTimeout por item (motivo já documentado em
// crm-automation-jobs.ts: passos agendados só em memória se perdiam
// silenciosamente a cada deploy).
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getBroadcastById, incrementBroadcastCounters } from "./broadcasts";
import { sendMessage } from "./whatsapp-send";
import { addMessage } from "./conversations";

export type BroadcastItemStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export type BroadcastItem = {
  id: string;
  campaignId: string;
  clientId: string;
  leadId?: string;
  phone: string;    // já normalizado via toDialablePhone() na criação
  name?: string;     // pra {{nome}} — ausente quando veio de lista manual
  status: BroadcastItemStatus;
  scheduledAt: string; // ISO — pré-computado na criação (startedAt + índice × delaySeconds)
  sentAt?: string;
  lastError?: string;
};

const FILE = path.join(process.cwd(), "data", "broadcast-items.json");

function load(): BroadcastItem[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: BroadcastItem[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

/** Cria a fila inteira de uma vez, cada item já com scheduledAt calculado —
 *  diferente de followups.ts (que agenda "o próximo" a cada envio porque a
 *  sequência pode ser interrompida pela resposta do lead), aqui a campanha
 *  inteira já é conhecida no momento da criação. */
export function createBroadcastItems(
  campaignId: string,
  clientId: string,
  recipients: { phone: string; name?: string; leadId?: string }[],
  startedAt: string,
  delaySeconds: number,
): BroadcastItem[] {
  const items = load();
  const startMs = new Date(startedAt).getTime();
  const created: BroadcastItem[] = recipients.map((r, i) => ({
    id: randomUUID(),
    campaignId,
    clientId,
    leadId: r.leadId,
    phone: r.phone,
    name: r.name,
    status: "pending",
    scheduledAt: new Date(startMs + i * delaySeconds * 1000).toISOString(),
  }));
  items.push(...created);
  save(items);
  return created;
}

export function getBroadcastItems(campaignId: string): BroadcastItem[] {
  return load().filter((i) => i.campaignId === campaignId);
}

/** Reivindica no máximo 1 item pendente vencido POR campanha a cada chamada
 *  (nunca todos de uma vez) — evita que, após um restart do container, uma
 *  campanha de 500 pessoas tenha 500 itens "vencidos" simultâneos e dispare
 *  todos em rajada, exatamente o que o delay configurável existe para evitar.
 *  Ignora itens de campanhas que não estejam "running" (pausada fica parada
 *  sem cancelar o restante). Mesmo esqueleto atômico de claimDueFollowUps:
 *  lê + marca "processing" num único write, evitando processamento
 *  duplicado entre ticks concorrentes. */
export function claimNextDueBroadcastItems(): BroadcastItem[] {
  const now = new Date();
  const items = load();
  const earliestDueByCampaign = new Map<string, BroadcastItem>();

  for (const item of items) {
    if (item.status !== "pending" || new Date(item.scheduledAt) > now) continue;
    const current = earliestDueByCampaign.get(item.campaignId);
    if (!current || item.scheduledAt < current.scheduledAt) earliestDueByCampaign.set(item.campaignId, item);
  }

  const claimed: BroadcastItem[] = [];
  for (const [campaignId, candidate] of earliestDueByCampaign) {
    const campaign = getBroadcastById(campaignId);
    if (campaign?.status !== "running") continue;
    const idx = items.findIndex((i) => i.id === candidate.id);
    if (idx >= 0) {
      items[idx].status = "processing";
      claimed.push({ ...items[idx] });
    }
  }

  if (claimed.length > 0) save(items);
  return claimed;
}

export function markItemSent(id: string): void {
  const items = load();
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) {
    items[idx].status = "sent";
    items[idx].sentAt = new Date().toISOString();
    save(items);
  }
}

export function markItemFailed(id: string, error: string): void {
  const items = load();
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) {
    items[idx].status = "failed";
    items[idx].lastError = error;
    save(items);
  }
}

/** Cancela em cascata os itens pending/processing de uma campanha — mesmo
 *  padrão de cancelFollowUpsForPhone. */
export function cancelBroadcastItems(campaignId: string): void {
  const items = load();
  let changed = false;
  for (const item of items) {
    if (item.campaignId === campaignId && (item.status === "pending" || item.status === "processing")) {
      item.status = "cancelled";
      changed = true;
    }
  }
  if (changed) save(items);
}

/** Interpola {{nome}}/{{nome_completo}} (primeiro nome / nome completo) na
 *  mensagem — mesma ideia de interpolateFollowUp em cron-tasks.ts, mas um
 *  item de broadcast pode não ter nome nenhum (veio de lista manual). */
function interpolateBroadcastMessage(msg: string, name: string | undefined): string {
  const firstName = name ? name.split(" ")[0] : "";
  return msg
    .replace(/\{\{nome\}\}/g, firstName)
    .replace(/\{\{nome_completo\}\}/g, name ?? "");
}

/** Orquestrador: claim → busca a campanha-pai → interpola a mensagem →
 *  envia pela conexão da campanha → marca sent/failed no item e incrementa
 *  o contador cacheado no pai. Chamado tanto pelo tick de 5s em
 *  instrumentation.ts quanto pela rota HTTP /api/agent/cron (gatilho
 *  externo redundante, ex: EasyPanel) — mesmo racional de
 *  processDueFollowUpsAndBatches. */
export async function processDueBroadcastItems(): Promise<{ processed: number }> {
  const due = claimNextDueBroadcastItems();
  let processed = 0;

  for (const item of due) {
    const campaign = getBroadcastById(item.campaignId);
    if (!campaign) {
      markItemFailed(item.id, "campanha não encontrada");
      processed++;
      continue;
    }

    try {
      const msg = interpolateBroadcastMessage(campaign.message, item.name);
      const ok = await sendMessage(item.phone, msg, item.clientId, campaign.connectionId);
      if (ok) {
        markItemSent(item.id);
        addMessage(item.phone, { role: "assistant", content: msg, ts: Date.now() }, item.clientId, { connId: campaign.connectionId });
        incrementBroadcastCounters(campaign.id, "sentCount");
      } else {
        markItemFailed(item.id, "sendMessage falhou — ver logs de evolution-api");
        incrementBroadcastCounters(campaign.id, "failedCount");
      }
    } catch (e) {
      console.error(`[broadcast-items] erro ao processar item ${item.id}:`, e);
      markItemFailed(item.id, e instanceof Error ? e.message : String(e));
      incrementBroadcastCounters(campaign.id, "failedCount");
    }
    processed++;
  }

  return { processed };
}
