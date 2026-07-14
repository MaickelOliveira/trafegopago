// Persistência dos passos agendados (com delay) de automações do CRM.
// Antes eram agendados só com setTimeout em memória — se o servidor reiniciasse
// antes do timer disparar (qualquer deploy), o passo era perdido silenciosamente,
// sem nenhum registro. Agora cada passo futuro vira um job em arquivo, reivindicado
// pelo cron (igual pending-responses.ts / followups.ts) — sobrevive a restarts.

import { readFileSync, writeFileSync, existsSync } from "fs";
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

function load(): CrmAutomationJob[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: CrmAutomationJob[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function scheduleJob(automationId: string, leadId: string, stepId: string, scheduledAt: string): CrmAutomationJob {
  const items = load();
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
  save(items);
  return job;
}

/** Reivindica jobs vencidos atomicamente: lê + marca "processing" em um único
 *  write, igual claimDueFollowUps — evita processamento duplicado entre ticks. */
export function claimDueJobs(): CrmAutomationJob[] {
  const now = new Date();
  const items = load();
  const claimed: CrmAutomationJob[] = [];
  for (const j of items) {
    if (j.status === "pending" && new Date(j.scheduledAt) <= now) {
      j.status = "processing";
      claimed.push({ ...j });
    }
  }
  if (claimed.length > 0) save(items);
  return claimed;
}

export function markJobDone(id: string): void {
  const items = load();
  const idx = items.findIndex((j) => j.id === id);
  if (idx >= 0) {
    items[idx].status = "done";
    save(items);
  }
}

export function markJobFailed(id: string, error: string): void {
  const items = load();
  const idx = items.findIndex((j) => j.id === id);
  if (idx >= 0) {
    items[idx].status = "failed";
    items[idx].lastError = error;
    save(items);
  }
}

export function getAllJobs(): CrmAutomationJob[] {
  return load();
}
