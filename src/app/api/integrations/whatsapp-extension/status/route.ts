import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDevicesForClient, getAllDevices, computeDisplayState } from "@/lib/extension-devices";
import { getClients, getAllAgentConfigs } from "@/lib/clients";
import { getFunnels } from "@/lib/funnels";
import type { DeviceStatusView } from "@/lib/extension-types";

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "client" && session.role !== "employee" && session.role !== "manager")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  if (session.role === "manager") {
    const clients = getClients();
    const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
    const funnelNameById = new Map(getFunnels().map((f) => [f.id, f.name]));

    // Mesmo padrão de evolution-manager/route.ts: considera TODAS as configs
    // de agente do cliente (legado + array por conexão), não só o campo
    // legado — senão um agente salvo pela tela normal de edição aparece como
    // "sem agente vinculado" mesmo estando configurado certinho.
    const connIdToAgent = new Map<string, boolean>();
    for (const client of clients) {
      for (const cfg of getAllAgentConfigs(client)) {
        if (cfg.whatsappConnectionId) connIdToAgent.set(cfg.whatsappConnectionId, cfg.enabled ?? false);
      }
    }

    const devices = getAllDevices().filter((d) => d.status === "active");
    const view: DeviceStatusView[] = devices.map((d) => ({
      id: d.id,
      devicePublicId: d.devicePublicId,
      connectorState: computeDisplayState(d),
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      clientId: d.clientId,
      clientName: clientNameById.get(d.clientId) ?? "(cliente não encontrado)",
      funnelId: d.funnelId,
      funnelName: d.funnelId ? funnelNameById.get(d.funnelId) : undefined,
      hasAgentLinked: connIdToAgent.has(d.id),
      agentEnabled: connIdToAgent.get(d.id) ?? false,
    }));
    return NextResponse.json({ devices: view });
  }

  if (!session.clientId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (session.role === "employee") {
    const { getEmployeeById } = await import("@/lib/employees");
    const emp = session.employeeId ? getEmployeeById(session.employeeId) : null;
    if (!emp || !emp.active || !emp.permissions?.canManageQR) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  }

  const devices = getDevicesForClient(session.clientId).filter((d) => d.status === "active");
  const view: DeviceStatusView[] = devices.map((d) => ({
    id: d.id,
    devicePublicId: d.devicePublicId,
    connectorState: computeDisplayState(d),
    lastSeenAt: d.lastSeenAt,
    createdAt: d.createdAt,
  }));

  return NextResponse.json({ devices: view });
}
