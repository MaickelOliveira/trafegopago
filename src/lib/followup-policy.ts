import type { AgentConfig } from "./clients";

const ZONE = "America/Sao_Paulo";
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function localParts(value: number) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

function localTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let value = target;
  // Resolve o deslocamento real do fuso, inclusive se o Brasil voltar a usar horário de verão.
  for (let attempt = 0; attempt < 3; attempt++) {
    const seen = localParts(value);
    value += target - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return value;
}

export function followUpWeeklyLimit(config: AgentConfig): number {
  return config.followUpMaxPer7Days === 1 ? 1 : 2;
}

export function validateFollowUpConfig(config: AgentConfig, officialMeta: boolean): string | null {
  const days = config.followUpSendDays ?? DEFAULT_DAYS;
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const start = config.followUpSendStart ?? "09:00";
  const end = config.followUpSendEnd ?? "18:00";
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return "Selecione pelo menos um dia válido para o follow-up.";
  if (!validTime(start) || !validTime(end) || start >= end) return "Confira o horário de envio do follow-up.";
  if (config.followUpMaxPer7Days !== undefined && ![1, 2].includes(config.followUpMaxPer7Days)) return "O limite semanal deve ser 1 ou 2 mensagens.";
  if (!config.followUpEnabled) return null;
  const steps = config.followUps ?? [];
  if (steps.length < 1 || steps.length > 2) return "Configure uma ou duas etapas antes de ativar o follow-up.";
  if (new Set(steps.map(step => step.id)).size !== steps.length || steps.some(step => !step.id || !Number.isFinite(step.delayHours) || step.delayHours < 0 || step.delayHours > 8760)) return "Confira as etapas e os intervalos do follow-up.";
  if (officialMeta && steps.some(step => step.messageType !== "template" || !step.templateId)) return "Na API oficial, cada etapa precisa de um modelo de mensagem aprovado.";
  if (!officialMeta && steps.some(step => step.messageType === "template")) return "Modelo de mensagem é exclusivo da API oficial.";
  if (steps.some(step => (step.messageType ?? "text") === "text" && !step.message.trim())) return "Preencha o texto de cada etapa.";
  return null;
}

/** Primeiro instante permitido, sempre no horário de São Paulo. */
export function nextAllowedFollowUpTime(earliest: number, config: AgentConfig): number {
  const start = config.followUpSendStart ?? "09:00";
  const end = config.followUpSendEnd ?? "18:00";
  const days = config.followUpSendDays ?? DEFAULT_DAYS;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end || days.length === 0) {
    throw new Error("Horário de follow-up inválido.");
  }
  const base = localParts(earliest);
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    if (!days.includes(date.getUTCDay())) continue;
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const open = localTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), startHour, startMinute);
    const close = localTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), endHour, endMinute);
    if (earliest < open) return open;
    if (earliest < close) return earliest;
  }
  throw new Error("Não há dia permitido para o follow-up.");
}
