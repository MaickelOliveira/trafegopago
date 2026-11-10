import { createHash } from "node:crypto";
import { readDocument, writeDocument, withDataTransaction } from "./document-store";
import type { ChatMessage } from "./conversations";

// Teto fixo: mesmo uma configuração equivocada não pode consumir créditos sem limite.
export const KANBAN_DAILY_AI_LIMIT = 30;
type LeadUsage = { fingerprint: string; at: number };
type DayUsage = { day: string; count: number; leads: Record<string, LeadUsage> };

function dayInSaoPaulo(now: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Reserva uma análise antes de chamar a IA; funciona entre reinícios e réplicas. */
export async function reserveKanbanAnalysis(clientId: string, leadId: string, message: ChatMessage, now = Date.now()): Promise<boolean> {
  if (!clientId || !leadId || message.role !== "user" || !message.content.trim() || !Number.isFinite(message.ts)) return false;
  const fingerprint = createHash("sha256").update(`${message.messageId ?? ""}:${message.ts}:${message.content}`).digest("hex");
  return withDataTransaction(async () => {
    const all = await readDocument<Record<string, DayUsage>>("kanban-usage.json", {});
    const day = dayInSaoPaulo(now);
    const usage = all[clientId]?.day === day ? all[clientId] : { day, count: 0, leads: {} };
    const previous = usage.leads[leadId];
    if (usage.count >= KANBAN_DAILY_AI_LIMIT || previous?.fingerprint === fingerprint) return false;
    usage.count++;
    usage.leads[leadId] = { fingerprint, at: now };
    all[clientId] = usage;
    await writeDocument("kanban-usage.json", all);
    return true;
  });
}
