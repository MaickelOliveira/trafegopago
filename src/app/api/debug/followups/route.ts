import { NextResponse } from "next/server";
import { getAllFollowUps, getDueFollowUps } from "@/lib/followups";
import { getClients, getAllAgentConfigs, getConfig } from "@/lib/clients";

export async function GET() {
  const all = getAllFollowUps();
  const due = getDueFollowUps();
  const globalConfig = getConfig();

  const clients = getClients().map((client) => {
    const cfgs = getAllAgentConfigs(client);
    return {
      id: client.id,
      name: client.name,
      agentConfigs: cfgs.map((c) => ({
        whatsappConnectionId: c.whatsappConnectionId,
        enabled: c.enabled,
        followUpEnabled: c.followUpEnabled,
        hasGeminiKey: !!(c.geminiApiKey || globalConfig.geminiApiKey),
        geminiKeySource: c.geminiApiKey ? "client" : globalConfig.geminiApiKey ? "global" : "MISSING",
        followUpsCount: c.followUps?.length ?? 0,
        followUpSteps: c.followUps?.map((s) => ({
          id: s.id,
          delayHours: s.delayHours,
          messageType: s.messageType,
          messagePreview: s.message?.slice(0, 60),
        })) ?? [],
      })),
    };
  });

  const summary = {
    total: all.length,
    pending: all.filter((f) => f.status === "pending").length,
    sent: all.filter((f) => f.status === "sent").length,
    cancelled: all.filter((f) => f.status === "cancelled").length,
    dueNow: due.length,
  };

  return NextResponse.json({
    summary,
    due,
    recent: all.slice(-20).reverse(),
    clients,
    now: new Date().toISOString(),
  });
}
