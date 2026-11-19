import { getClients, getConfig } from "./clients";
import { getEmployeeByEmail } from "./employees";
export async function assertAvailableLogin(email: string, excludeClient?: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  if ((await getClients()).some(client => client.id !== excludeClient && client.email.toLowerCase() === normalized) || !!await getEmployeeByEmail(normalized) || (process.env.MANAGER_EMAIL || (await getConfig()).manager.email).toLowerCase() === normalized) throw Error("Este e-mail já está cadastrado.");
}
