import { readDocument, writeDocument, withDataTransaction } from "./document-store";
// Persistência dos passos agendados (com delay) de automações do CRM.
// Antes eram agendados só com setTimeout em memória — se o servidor reiniciasse
// antes do timer disparar (qualquer deploy), o passo era perdido silenciosamente,
// sem nenhum registro. Agora cada passo futuro vira um job em arquivo, reivindicado
// pelo cron (igual pending-responses.ts / followups.ts) — sobrevive a restarts.

import path from "path";
import { randomUUID } from "crypto";

/** stepId usado para automações legadas (single-action, sem steps[]) */
export const LEGACY_STEP_ID = "__legacy__";

export type CrmAutomationJob = {
  id: string;
  automationId: string;
  leadId: string;
  stepId: string; // CrmStep.id ou LEGACY_STEP_ID
  scheduledAt: string; // ISO
  status: "pending" | "processing" | "done" | "cancelled" | "failed";
  createdAt: string;
  lastError?: string;
};

const FILE = path.join(process.cwd(), "data", "crm-automation-jobs.json");

async function load(): Promise<CrmAutomationJob[]> {
  return (await readDocument<CrmAutomationJob[]>("crm-automation-jobs.json", []));
}

async function save(items: CrmAutomationJob[]) {
  await writeDocument("crm-automation-jobs.json", items);
}

export async function scheduleJob(automationId: string, leadId: string, stepId: string, scheduledAt: string): Promise<CrmAutomationJob> {
  return withDataTransaction(async () => {
  const items = (await load());
  const job: CrmAutomationJob = {
    id: randomUUID(),
    automationId,
    leadId,
    stepId,
    scheduledAt,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  items.push(job);
  (await save(items));
  return job;

  });
}

/** Reivindica jobs vencidos atomicamente: lê + marca "processing" em um único
 *  write, igual claimDueFollowUps — evita processamento duplicado entre ticks. */
export async function claimDueJobs(): Promise<CrmAutomationJob[]> {
  return withDataTransaction(async () => {
  const now = new Date();
  const items = (await load());
  const claimed: CrmAutomationJob[] = [];
  for (const j of items) {
    if (j.status === "pending" && new Date(j.scheduledAt) <= now) {
      j.status = "processing";
      claimed.push({ ...j });
    }
  }
  if (claimed.length > 0) (await save(items));
  return claimed;

  });
}

export async function markJobDone(id: string): Promise<void> {
  return withDataTransaction(async () => {
  const items = (await load());
  const idx = items.findIndex((j) => j.id === id);
  if (idx >= 0) {
    items[idx].status = "done";
    (await save(items));
  }

  });
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  return withDataTransaction(async () => {
  const items = (await load());
  const idx = items.findIndex((j) => j.id === id);
  if (idx >= 0) {
    items[idx].status = "failed";
    items[idx].lastError = error;
    (await save(items));
  }

  });
}

export async function getAllJobs(): Promise<CrmAutomationJob[]> {
  return (await load());
}
