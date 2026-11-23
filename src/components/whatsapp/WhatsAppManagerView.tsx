"use client";
import { useState,useEffect,useCallback,useRef } from "react";
import { EvolutionView } from "./EvolutionView";


export type FunnelOption = { id: string; name: string; clientId: string | null };

export type ClientOption = {
  id: string; name: string; color: string; agentEnabled: boolean; agentConnectionId: string | null;
  agents?: { name?: string; whatsappConnectionId?: string; isOrphaned?: boolean }[];
};


/** Select pra escolher qual agente já configurado usar nesta conexão — a config
 *  do agente não é presa à sessão (que pode ser excluída/recriada a qualquer
 *  momento), é uma entidade própria que só aponta pra sessão atual. Lista TODOS
 *  os agentes do cliente, não só os órfãos: escolher um que já está em uso em
 *  outra conexão simplesmente move ele pra cá. */
export function ReuseAgentSelect({ clients, clientId, value, onChange, accentColor = "green" }: {
  clients: ClientOption[];
  clientId: string;
  value: string;
  onChange: (v: string) => void;
  accentColor?: "green" | "blue" | "violet";
}) {
  const agents = (clients.find(c => c.id === clientId)?.agents ?? []).filter(a => a.whatsappConnectionId);
  if (agents.length === 0) return null;
  return (
    <div className="mb-2">
      <label className="block text-xs font-medium text-slate-500 mb-1">Qual agente usar nesta conexão?</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-${accentColor}-400`}
      >
        <option value="">— Criar agente novo —</option>
        {agents.map(a => (
          <option key={a.whatsappConnectionId} value={a.whatsappConnectionId}>
            {a.name?.trim() || "Agente sem nome"}{a.isOrphaned ? "" : " (em uso em outra conexão — será movido pra cá)"}
          </option>
        ))}
      </select>
    </div>
  );
}


/** Calcula os defaults do modal "Vincular" pra um cliente: se ele tem alguma
 *  config de agente órfã (presa a uma conexão excluída/substituída), liga o
 *  toggle "Ativar Agente IA" automaticamente e, havendo só uma candidata,
 *  já pré-seleciona ela pra reaproveitar. Sem isso, o toggle nasce desligado
 *  pra toda conexão nova e o combo de reaproveitamento fica escondido atrás
 *  dele — o usuário nunca vê que existe uma config antiga esperando e acaba
 *  reconfigurando o agente do zero. */
export function getOrphanLinkDefaults(clients: ClientOption[], clientId: string): { linkAgent: boolean; reuseConnectionId: string } {
  const orphaned = (clients.find(c => c.id === clientId)?.agents ?? []).filter(a => a.isOrphaned && a.whatsappConnectionId);
  if (orphaned.length === 0) return { linkAgent: false, reuseConnectionId: "" };
  return { linkAgent: true, reuseConnectionId: orphaned.length === 1 ? (orphaned[0].whatsappConnectionId ?? "") : "" };
}


export function ClientAgentSelect({ clients, value, onChange, accentColor = "green" }: {
  clients: ClientOption[];
  value: string;
  onChange: (v: string) => void;
  accentColor?: "green" | "blue";
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-${accentColor}-400 mb-2`}
    >
      <option value="">— Sem agente —</option>
      {clients.filter(c => (c.agents ?? []).length > 0).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}


export function ClientFunnelSelect({ clients, funnels, value, onChange, accentColor = "green" }: {
  clients: ClientOption[];
  funnels: FunnelOption[];
  value: string;
  onChange: (v: string) => void;
  accentColor?: "green" | "blue";
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-${accentColor}-400`}
    >
      <option value="">— Sem vínculo —</option>
      {clients.map(c => {
        const clientFunnels = funnels.filter(f => f.clientId === c.id);
        return (
          <optgroup key={c.id} label={c.name}>
            {clientFunnels.length > 0
              ? clientFunnels.map(f => (
                  <option key={f.id} value={f.id}>{c.name} — {f.name}</option>
                ))
              : <option value={`auto:${c.id}`}>Funil Principal (criar automaticamente)</option>
            }
          </optgroup>
        );
      })}
    </select>
  );
}


// ── MetaApiView ───────────────────────────────────────────────────
type MetaConn = {
  configured:boolean;
  id: string;
  phoneNumberId: string;
  tokenMasked: string;
  verifyToken: string;
  funnelId: string;
  funnelName: string;
  clientId: string | null;
  clientName: string | null;
  hasAgentLinked: boolean;
  agentEnabled: boolean;
};


function MetaApiView({ funnels, clients, appBaseUrl }: { funnels: FunnelOption[]; clients: ClientOption[]; appBaseUrl: string }) {
  const [connections, setConnections] = useState<MetaConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [linkingConn, setLinkingConn] = useState<MetaConn | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add form
  const [addPhoneId, setAddPhoneId] = useState("");
  const [addToken, setAddToken] = useState("");
  const [addVerifyToken, setAddVerifyToken] = useState("trafegopago");
  const [addFunnelId, setAddFunnelId] = useState("");
  const [addClientId, setAddClientId] = useState("");
  const [addLinkAgent, setAddLinkAgent] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Link form
  const [linkFunnelId, setLinkFunnelId] = useState("");
  const [linkClientId, setLinkClientId] = useState("");
  const [linkAgent, setLinkAgent] = useState(false);
  const [savingLink, setSavingLink] = useState(false);

  const webhookUrl = `${appBaseUrl}/api/whatsapp/meta`;

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/meta-manager");
      if (res.ok) setConnections(await res.json());
    } catch { /**/ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  async function handleAdd() {
    if (!addPhoneId || !addToken || !addFunnelId) {
      setAddError("Phone Number ID, Token e Funil são obrigatórios"); return;
    }
    setAdding(true); setAddError("");
    const res = await fetch("/api/whatsapp/meta-manager", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funnelId: addFunnelId, phoneNumberId: addPhoneId, token: addToken, verifyToken: addVerifyToken, clientId: addClientId || null, linkAgent: addLinkAgent }),
    });
    if (!res.ok) { setAddError("Erro ao salvar"); setAdding(false); return; }
    setShowAddModal(false);
    setAddPhoneId(""); setAddToken(""); setAddFunnelId(""); setAddClientId(""); setAddLinkAgent(false);
    fetchConnections();
    setAdding(false);
  }

  async function handleUpdateLink() {
    if (!linkingConn) return;
    setSavingLink(true);
    await fetch("/api/whatsapp/meta-manager", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connId: linkingConn.id, newFunnelId: linkFunnelId || undefined, clientId: linkClientId || null, linkAgent }),
    });
    setSavingLink(false); setLinkingConn(null); fetchConnections();
  }

  async function handleDelete(connId: string) {
    setDeletingId(null);
    await fetch("/api/whatsapp/meta-manager", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connId }),
    });
    fetchConnections();
  }

  return (
    <div className="py-6 sm:px-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">API oficial da Meta</h2>
          <p className="text-sm text-slate-500 mt-0.5">Vincule o número oficial ao cliente e ao funil.</p>
        </div>
        <button
          onClick={() => { setAddPhoneId(""); setAddToken(""); setAddVerifyToken("trafegopago"); setAddFunnelId(""); setAddClientId(""); setAddLinkAgent(false); setAddError(""); setShowAddModal(true); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shadow-sm"
        >
          <span className="text-lg leading-none">+</span> Adicionar número
        </button>
      </div>

      {/* Webhook URL info */}
      <details className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6"><summary className="cursor-pointer text-sm font-semibold text-blue-800">Configuração de recebimento na Meta</summary><div className="flex items-start gap-3 mt-4">
        <span className="text-xl mt-0.5">🔗</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-800 mb-1">URL do Webhook (Meta Developer)</p>
          <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 px-3 py-2">
            <span className="text-xs font-mono text-blue-700 flex-1 break-all">{webhookUrl}</span>
            <button onClick={() => navigator.clipboard.writeText(webhookUrl).catch(() => {})}
              className="text-xs font-semibold text-blue-600 whitespace-nowrap hover:text-blue-800">Copiar</button>
          </div>
          <p className="text-xs text-blue-600 mt-1.5">Configure no Meta Business → API do WhatsApp → Configuração do Webhook</p>
        </div>
      </div>

      </details>
      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-blue-500 rounded-full" />
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <span className="text-5xl mb-4">🏢</span>
          <p className="text-lg font-semibold text-slate-600 mb-1">Nenhuma conexão Meta configurada</p>
          <p className="text-sm mb-6">Adicione sua primeira conexão via API Oficial do WhatsApp</p>
          <button onClick={() => setShowAddModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition">
            + Adicionar número
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {connections.map(conn => (
            <div key={conn.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5">
              <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <span className="mt-1.5 flex-shrink-0 h-3 w-3 rounded-full bg-blue-500" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900">{conn.phoneNumberId || "Número ainda não informado"}</h3>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{conn.configured?"Credenciais cadastradas":"Configuração incompleta"}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {conn.funnelName
                        ? <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-0.5 font-medium">🎯 {conn.funnelName}</span>
                        : <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5">Sem funil</span>}
                      {conn.hasAgentLinked && (
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${conn.agentEnabled ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                          🤖 {conn.clientName}{conn.agentEnabled ? " · ativo" : " · inativo"}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">Verify: <code className="font-mono text-slate-600">{conn.verifyToken}</code></span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => { setLinkingConn(conn); setLinkFunnelId(conn.funnelId ?? ""); setLinkClientId(conn.clientId ?? ""); setLinkAgent(conn.hasAgentLinked); }}
                    className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:text-violet-700 hover:bg-violet-50 transition"
                    title="Vincular funil/agente">
                    🔀 Vincular
                  </button>
                  {deletingId === conn.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDelete(conn.id)} className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Confirmar</button>
                      <button onClick={() => setDeletingId(null)} className="text-xs text-slate-400 px-1.5">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeletingId(conn.id)} className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 transition text-base">🗑️</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {(showAddModal || !!linkingConn) && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => { setShowAddModal(false); setLinkingConn(null); }} />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <Modal title="Adicionar número API" onClose={() => setShowAddModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">📱 Phone Number ID</label>
              <input autoFocus value={addPhoneId} onChange={e => setAddPhoneId(e.target.value)}
                placeholder="Ex: 123456789012345"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
              <p className="text-xs text-slate-400 mt-1">Meta Business → API do WhatsApp → número do telefone</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">🔑 Access Token</label>
              <input value={addToken} onChange={e => setAddToken(e.target.value)} type="password"
                placeholder="Token de acesso permanente"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">🔐 Verify Token</label>
              <input value={addVerifyToken} onChange={e => setAddVerifyToken(e.target.value)}
                placeholder="trafegopago"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
              <p className="text-xs text-slate-400 mt-1">Token de verificação do webhook (você escolhe — deve coincidir no Meta)</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">🎯 Funil do CRM</label>
              <ClientFunnelSelect clients={clients} funnels={funnels} value={addFunnelId} onChange={setAddFunnelId} accentColor="blue" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <ClientAgentSelect clients={clients} value={addClientId} onChange={setAddClientId} accentColor="blue" />
              {addClientId && (
                <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => setAddLinkAgent(v => !v)}>
                  <div className={`relative w-10 rounded-full transition-colors ${addLinkAgent ? "bg-blue-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                    <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: addLinkAgent ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-slate-700">Ativar Agente IA nesta conexão</span>
                </label>
              )}
            </div>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowAddModal(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleAdd} disabled={adding || !addPhoneId || !addToken || !addFunnelId}
                className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                {adding ? "Salvando..." : "Salvar Conexão"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Link Modal */}
      {linkingConn && (
        <Modal title={`Vincular — ${linkingConn.phoneNumberId}`} onClose={() => setLinkingConn(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🎯 Funil do CRM</label>
              <ClientFunnelSelect clients={clients} funnels={funnels} value={linkFunnelId} onChange={setLinkFunnelId} accentColor="blue" />
              <p className="text-xs text-slate-400 mt-1">Mensagens recebidas criarão leads neste funil.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <ClientAgentSelect clients={clients} value={linkClientId} onChange={setLinkClientId} accentColor="blue" />
              {linkClientId && (
                <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => setLinkAgent(v => !v)}>
                  <div className={`relative w-10 rounded-full transition-colors ${linkAgent ? "bg-blue-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                    <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: linkAgent ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-slate-700">Ativar Agente IA nesta conexão</span>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setLinkingConn(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleUpdateLink} disabled={savingLink}
                className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {savingLink ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


export function ActionBtn({ onClick, title, className, children }: { onClick: () => void; title: string; className: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={`h-9 w-9 flex items-center justify-center rounded-xl border text-base transition ${className}`}>
      {children}
    </button>
  );
}


export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 ${wide ? "w-[520px]" : "w-[440px]"} max-w-[95vw] max-h-[90vh] overflow-y-auto`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-slate-900 text-lg">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
      </div>
      {children}
    </div>
  );
}

export function WhatsAppManagerView({funnels,clients,appBaseUrl}:{funnels:FunnelOption[];clients:ClientOption[];appBaseUrl:string}){const[tab,setTab]=useState<"evolution"|"meta">("evolution");return <div className="nexo-workspace"><header className="nexo-page-heading compact"><div><span className="nexo-eyebrow">CANAIS DE ATENDIMENTO</span><h1>WhatsApp</h1><p>Conecte o número e escolha o cliente, o funil e o agente.</p></div></header><div className="nexo-filter-row" aria-label="Provedor de WhatsApp"><button aria-pressed={tab==="evolution"} onClick={()=>setTab("evolution")}>Evolution</button><button aria-pressed={tab==="meta"} onClick={()=>setTab("meta")}>API oficial da Meta</button></div>{tab==="evolution"?<EvolutionView funnels={funnels} clients={clients} appBaseUrl={appBaseUrl}/>:<MetaApiView funnels={funnels} clients={clients} appBaseUrl={appBaseUrl}/>}</div>;}
