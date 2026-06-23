import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type FollowUpType = "followup" | "reminder" | "appointment_reminder";
export type FollowUpStatus = "pending" | "sent" | "cancelled";

export type FollowUp = {
  id: string;
  clientId: string;
  phone: string;
  scheduledAt: string; // ISO timestamp
  message: string;
  type: FollowUpType;
  status: FollowUpStatus;
  stepIndex?: number;           // índice do step na sequência (0, 1, 2...)
  stepId?: string;              // id do FollowUpStep configurado
  appointmentEventId?: string;  // Google Calendar event ID (para appointment_reminder)
  createdAt: string;
  messageType?: "text" | "ai" | "template"; // tipo de envio
  templateId?: string;                       // id do template Meta
  templateVariables?: Record<string, string>; // variáveis do template
  connId?: string;              // conexão/número de origem da conversa — garante que o
                                 // follow-up seja enviado pelo MESMO canal (WPPConnect,
                                 // UazAPI ou Meta) que o lead conversou, não outro
};

const FILE = path.join(process.cwd(), "data", "followups.json");

function load(): FollowUp[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(items: FollowUp[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2));
}

export function scheduleFollowUp(
  data: Omit<FollowUp, "id" | "status" | "createdAt">
): FollowUp {
  const items = load();
  const item: FollowUp = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  save(items);
  return item;
}

export function getDueFollowUps(): FollowUp[] {
  const now = new Date();
  return load().filter(
    (f) => f.status === "pending" && new Date(f.scheduledAt) <= now
  );
}

export function getPendingFollowUps(clientId?: string): FollowUp[] {
  return load().filter(
    (f) => f.status === "pending" && (!clientId || f.clientId === clientId)
  );
}

export function getAllFollowUps(clientId?: string): FollowUp[] {
  return load().filter((f) => !clientId || f.clientId === clientId);
}

export function markSent(id: string): void {
  const items = load();
  const idx = items.findIndex((f) => f.id === id);
  if (idx >= 0) {
    items[idx].status = "sent";
    save(items);
  }
}

export function cancelFollowUp(id: string): void {
  const items = load();
  const idx = items.findIndex((f) => f.id === id);
  if (idx >= 0) {
    items[idx].status = "cancelled";
    save(items);
  }
}

// Inicia a sequência de follow-ups para um lead (step 0)
export function startFollowUpSequence(
  clientId: string,
  phone: string,
  steps: { id: string; delayHours: number; message: string; messageType?: string; templateId?: string; templateVariables?: Record<string, string> }[],
  connId?: string
): void {
  if (steps.length === 0) return;
  const first = steps[0];
  const scheduledAt = new Date(Date.now() + first.delayHours * 3600000).toISOString();
  scheduleFollowUp({
    clientId,
    phone,
    scheduledAt,
    message: first.message,
    type: "followup",
    connId,
    stepIndex: 0,
    stepId: first.id,
    messageType: first.messageType as "text" | "ai" | "template" | undefined,
    templateId: first.templateId,
    templateVariables: first.templateVariables,
  });
}

export function cancelFollowUpsForPhone(clientId: string, phone: string): void {
  const items = load();
  let changed = false;
  for (const item of items) {
    if (item.clientId === clientId && item.phone === phone && item.status === "pending") {
      item.status = "cancelled";
      changed = true;
    }
  }
  if (changed) save(items);
}
