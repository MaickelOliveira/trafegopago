export type AutomationKey =
  | "dailyReport"
  | "weeklySummary"
  | "highCplAlert"
  | "budgetAlert"
  | "campaignPausedAlert";

export interface AutomationSettings {
  enabled: boolean;
  clientEnabled?: boolean; // client opt-out override
  time?: string;           // "08:00" — dailyReport
  dayOfWeek?: number;      // 0=Sunday — weeklySummary
  threshold?: number;      // % above CPL target — highCplAlert
  budgetPct?: number;      // % of daily budget spent — budgetAlert
}

export type AutomationsConfig = Partial<Record<AutomationKey, AutomationSettings>>;

export interface AutomationMeta {
  key: AutomationKey;
  icon: string;
  label: string;
  description: string;
  managerOnly: boolean; // client cannot toggle, only manager controls
}

export const AUTOMATIONS: AutomationMeta[] = [
  {
    key: "dailyReport",
    icon: "📊",
    label: "Relatório diário",
    description: "Resumo diário de gastos, leads e CPL direto no WhatsApp",
    managerOnly: false,
  },
  {
    key: "weeklySummary",
    icon: "📅",
    label: "Resumo semanal",
    description: "Visão completa da semana — campanhas, leads e investimento",
    managerOnly: false,
  },
  {
    key: "highCplAlert",
    icon: "⚠️",
    label: "Alerta de CPL alto",
    description: "Avisa quando o CPL ultrapassa o limite configurado pelo gestor",
    managerOnly: true,
  },
  {
    key: "budgetAlert",
    icon: "💸",
    label: "Alerta de orçamento",
    description: "Avisa quando o gasto diário atinge uma porcentagem do budget",
    managerOnly: true,
  },
  {
    key: "campaignPausedAlert",
    icon: "🔔",
    label: "Campanha pausada",
    description: "Avisa quando uma campanha ativa for pausada inesperadamente",
    managerOnly: false,
  },
];
