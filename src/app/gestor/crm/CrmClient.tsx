"use client";

import { useState, useRef, useEffect } from "react";
import { KanbanBoard } from "@/components/crm/KanbanBoard";
import { WhatsAppStatus } from "@/components/crm/WhatsAppStatus";
import type { Lead } from "@/lib/leads";
import type { Funnel } from "@/lib/funnels";

type Client = { id: string; name: string; color: string; metaAccountId?: string; pixelId?: string; kanbanAgentEnabled?: boolean };

function ClientSelector({ clients, selected, onSelect }: {
  clients: Client[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = clients.find(c => c.id === selected);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition shadow-sm">
        <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: current?.color || "#94A3B8" }} />
        {current?.name ?? "Selecionar cliente"}
        <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-56 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
          {clients.map(c => (
            <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition ${c.id === selected ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"}`}>
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: c.color || "#94A3B8" }} />
              {c.name}
              {c.id === selected && <span className="ml-auto text-blue-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STORAGE_KEY = "crm_selected_client";

export function CrmClient({ clients, initialLeads, initialFunnels, selectedClient: fixedClient }: {
  clients: Client[];
  initialLeads: Lead[];
  initialFunnels: Funnel[];
  selectedClient?: string; // quando passado, fixa o cliente sem seletor
}) {
  const [selectedClient, setSelectedClient] = useState<string>(() => {
    if (fixedClient) return fixedClient;
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && clients.find(c => c.id === saved)) return saved;
    }
    return clients[0]?.id ?? "";
  });

  const [funnels, setFunnels] = useState<Funnel[]>(initialFunnels);
  const [creating, setCreating] = useState(false);

  // Persiste cliente selecionado
  function selectClient(id: string) {
    setSelectedClient(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  const client = clients.find(c => c.id === selectedClient);
  const clientFunnels = funnels.filter(f => f.clientId === selectedClient);

  // Auto-cria funil padrão se cliente não tem nenhum
  useEffect(() => {
    if (!selectedClient || clientFunnels.length > 0 || creating) return;
    setCreating(true);
    fetch("/api/crm/funnels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Funil Principal", clientId: selectedClient }),
    })
      .then(r => r.json())
      .then(created => { setFunnels(prev => [...prev, created]); setCreating(false); })
      .catch(() => setCreating(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 lg:px-8 pt-6 pb-0 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">CRM</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {client ? `Pipeline de leads — ${client.name}` : "Selecione um cliente"}
          </p>
        </div>
        <WhatsAppStatus
          clients={clients}
          clientId={selectedClient}
          funnels={clientFunnels.map(f => ({ id: f.id, name: f.name, clientId: f.clientId, whatsappPhone: f.whatsappPhone }))}
        />
      </div>

      {!fixedClient && (
        <div className="px-6 lg:px-8 pt-3 pb-4 flex-shrink-0 border-b border-slate-100">
          <ClientSelector clients={clients} selected={selectedClient} onSelect={selectClient} />
        </div>
      )}

      <div className="flex-1 min-h-0 p-6 lg:p-8 pt-4">
        {creating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-500">Criando funil para {client?.name}...</p>
            </div>
          </div>
        ) : (
          <KanbanBoard
            key={selectedClient}
            initialLeads={initialLeads}
            initialFunnels={clientFunnels}
            clients={clients}
            selectedClient={selectedClient}
          />
        )}
      </div>
    </div>
  );
}
