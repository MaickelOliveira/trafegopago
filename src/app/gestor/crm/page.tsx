import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { getLeads, attachLeadsHeat } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";
import { CrmClient } from "./CrmClient";

export default async function CrmPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const clients = getClients().map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    metaAccountId: c.adAccounts.find((a) => a.platform === "meta")?.id,
    pixelId: c.pixelId,
    kanbanAgentEnabled: c.kanbanAgentEnabled !== false, // default true
  }));
  const leads   = attachLeadsHeat(getLeads());
  const funnels = getFunnels();

  return (
    <CrmClient
      clients={clients}
      initialLeads={leads}
      initialFunnels={funnels}
    />
  );
}
