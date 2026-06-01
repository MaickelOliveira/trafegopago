import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DIR  = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "employees.json");

export type EmployeePermissions = {
  canDeleteLeads: boolean;       // apagar leads — padrão: false
  canManageQR: boolean;          // desconectar / reconectar WhatsApp — padrão: false
  canViewAutomations: boolean;   // ver aba Automações — padrão: false
  canViewCreatives: boolean;     // ver aba Criativos — padrão: true
  canViewAgentIa: boolean;       // ver aba Agente de IA — padrão: false
  canManageLeadMessages: boolean;// enviar mensagens pelo inbox — padrão: true
};

export const DEFAULT_PERMISSIONS: EmployeePermissions = {
  canDeleteLeads: false,
  canManageQR: false,
  canViewAutomations: false,
  canViewCreatives: true,
  canViewAgentIa: false,
  canManageLeadMessages: true,
};

export type Employee = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  passwordHash: string;
  active: boolean;               // false = bloqueado
  allowedFunnelIds: string[];    // lista de IDs; ["*"] = todos os funis
  permissions: EmployeePermissions;
  createdAt: number;
};

function load(): Employee[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch { return []; }
}

function save(data: Employee[]) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getEmployees(clientId: string): Employee[] {
  return load().filter((e) => e.clientId === clientId);
}

export function getEmployeeById(id: string): Employee | undefined {
  return load().find((e) => e.id === id);
}

export function getEmployeeByEmail(email: string): Employee | undefined {
  return load().find((e) => e.email.toLowerCase() === email.toLowerCase());
}

export function createEmployee(
  data: Omit<Employee, "id" | "createdAt">
): Employee {
  const all = load();
  const employee: Employee = {
    ...data,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  all.push(employee);
  save(all);
  return employee;
}

export function updateEmployee(
  id: string,
  patch: Partial<Omit<Employee, "id" | "clientId" | "createdAt">>
): Employee | null {
  const all = load();
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  save(all);
  return all[idx];
}

export function deleteEmployee(id: string): boolean {
  const all = load();
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  save(all);
  return true;
}

/** Verifica se o funcionário tem acesso a um funil específico */
export function employeeCanAccessFunnel(employee: Employee, funnelId: string): boolean {
  if (!employee.active) return false;
  if (employee.allowedFunnelIds.includes("*")) return true;
  return employee.allowedFunnelIds.includes(funnelId);
}
