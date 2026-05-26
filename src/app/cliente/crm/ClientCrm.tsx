"use client";

import { useState } from "react";
import { KanbanBoard } from "@/components/crm/KanbanBoard";
import { WhatsAppStatus } from "@/components/crm/WhatsAppStatus";
import type { Lead } from "@/lib/leads";
import type { Funnel } from "@/lib/funnels";

export function ClientCrm({ clientId, clientName, clientColor, initialLeads, initialFunnels }: {
  clientId: string;
  clientName: string;
  clientColor: string;
  initialLeads: Lead[];
  initialFunnels: Funnel[];
}) {
  const [funnels, setFunnels] = useState<Funnel[]>(initialFunnels);
  const [creating, setCreating] = useState(false);

  const client = [{ id: clientId, name: clientName, color: clientColor }];

  // Auto-cria funil se não tem
  async function ensureFunnel() {
    if (funnels.length > 0 || creating) return;
    setCreating(true);
    const res = await fetch("/api/crm/funnels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Funil Principal", clientId }),
    });
    const created = await res.json();
    setFunnels([created]);
    setCreating(false);
  }

  // Garante funil ao montar
  if (funnels.length === 0 && !creating) ensureFunnel();

  return (
    <div className="h-[calc(100vh-57px)] flex flex-col">
      <div className="flex items-center justify-between px-6 lg:px-8 pt-5 pb-0 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">CRM</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie seus leads — {clientName}</p>
        </div>
        <WhatsAppStatus
          clients={client}
          clientId={clientId}
          funnels={funnels.map(f => ({ id: f.id, name: f.name, clientId: f.clientId, connections: f.connections }))}
        />
      </div>

      <div className="flex-1 min-h-0 p-6 lg:p-8 pt-4">
        {creating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-500">Preparando seu CRM...</p>
            </div>
          </div>
        ) : (
          <KanbanBoard
            key={clientId}
            initialLeads={initialLeads}
            initialFunnels={funnels}
            clients={client}
            selectedClient={clientId}
          />
        )}
      </div>
    </div>
  );
}
