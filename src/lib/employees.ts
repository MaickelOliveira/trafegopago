import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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
  canViewWaba: boolean;          // ver aba Disparos WA (templates oficiais) — padrão: false
};

export const DEFAULT_PERMISSIONS: EmployeePermissions = {
  canDeleteLeads: false,
  canManageQR: false,
  canViewAutomations: false,
  canViewCreatives: true,
  canViewAgentIa: false,
  canManageLeadMessages: true,
  canViewWaba: false,
};

export type Employee = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  passwordHash: string;
  sessionVersion?: number;
  active: boolean;               // false = bloqueado
  allowedFunnelIds: string[];    // lista de IDs; ["*"] = todos os funis
  permissions: EmployeePermissions;
  logoUrl?: string;              // foto/logo do funcionário
  createdAt: number;
};

async function load(): Promise<Employee[]> {
  return (await readDocument<Employee[]>("employees.json", []));
}

async function save(data: Employee[]) {
  await writeDocument("employees.json", data);
}

export async function getEmployees(clientId: string): Promise<Employee[]> {
  return (await load()).filter((e) => e.clientId === clientId);
}

export async function getEmployeeById(id: string): Promise<Employee | undefined> {
  return (await load()).find((e) => e.id === id);
}

export async function getEmployeeByEmail(email: string): Promise<Employee | undefined> {
  return (await load()).find((e) => e.email.toLowerCase() === email.toLowerCase());
}

export async function createEmployee(
  data: Omit<Employee, "id" | "createdAt">
): Promise<Employee> {
  return withDataTransaction(async () => {
  const all = (await load());
  const employee: Employee = {
    ...data,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  all.push(employee);
  (await save(all));
  return employee;

  });
}

export async function updateEmployee(
  id: string,
  patch: Partial<Omit<Employee, "id" | "clientId" | "createdAt">>
): Promise<Employee | null> {
  return withDataTransaction(async () => {
  const all = (await load());
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const sessionVersion = patch.passwordHash && patch.passwordHash !== all[idx].passwordHash ? (all[idx].sessionVersion ?? 0) + 1 : (all[idx].sessionVersion ?? 0);
  all[idx] = { ...all[idx], ...patch, sessionVersion };
  (await save(all));
  return all[idx];

  });
}

export async function deleteEmployee(id: string): Promise<boolean> {
  return withDataTransaction(async () => {
  const all = (await load());
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  (await save(all));
  return true;

  });
}

/** Verifica se o funcionário tem acesso a um funil específico */
export function employeeCanAccessFunnel(employee: Employee, funnelId: string): boolean {
  if (!employee.active) return false;
  if (employee.allowedFunnelIds.includes("*")) return true;
  return employee.allowedFunnelIds.includes(funnelId);
}
