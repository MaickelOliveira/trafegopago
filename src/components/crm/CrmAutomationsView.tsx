"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { CrmAutomation, CrmTrigger, CrmChannel } from "@/lib/crm-automations";
import type { Funnel } from "@/lib/funnels";
import type { WabaTemplate } from "@/lib/waba-templates";

type ConnectionInfo = {
  id: string;
  type: "uazapi" | "meta";
  phone: string;
  funnelId: string;
  funnelName: string;
};

type Props = {
  clientId: string;
  initialAutomations: CrmAutomation[];
  funnels: Funnel[];
  connections: ConnectionInfo[];
  approvedTemplates: WabaTemplate[];
};

const TRIGGER_LABEL: Record<CrmTrigger, string> = {
  lead_created: "🎯 Lead cadastrado",
  column_changed: "↕ Lead muda de coluna",
};

const CHANNEL_STYLE: Record<CrmChannel, string> = {
  uazapi: "bg-blue-100 text-blue-700",
  waba:   "bg-green-100 text-green-700",
};

const CHANNEL_LABEL: Record<CrmChannel, string> = {
  uazapi: "🔵 UazapiGO",
  waba:   "🟢 Meta Oficial",
};

const DELAY_OPTIONS = [
  { value: 0,   label: "Imediato" },
  { value: 1,   label: "1 minuto" },
  { value: 5,   label: "5 minutos" },
  { value: 10,  label: "10 minutos" },
  { value: 30,  label: "30 minutos" },
  { value: 60,  label: "1 hora" },
  { value: 120, label: "2 horas" },
  { value: 1440,label: "24 horas" },
];

type FormState = {
  name: string;
  trigger: CrmTrigger;
  funnelId: string;
  triggerColumnId: string;
  channel: CrmChannel;
  connectionId: string;
  message: string;
  templateId: string;
  templateVariables: Record<string, string[]>; // componentType -> [val para {{1}}, val para {{2}}, ...]
  delayMinutes: number;
};

const BLANK_FORM = (uazapiConnId: string, templateId: string): FormState => ({
  name: "",
  trigger: "lead_created",
  funnelId: "",
  triggerColumnId: "",
  channel: "uazapi",
  connectionId: uazapiConnId,
  message: "Olá {{nome}}! Recebemos seu cadastro. Em breve entraremos em contato. 😊",
  templateId,
  templateVariables: {},
  delayMinutes: 0,
});

export function CrmAutomationsView({
  clientId, initialAutomations, funnels, connections, approvedTemplates,
}: Props) {
  const [automations, setAutomations] = useState<CrmAutomation[]>(initialAutomations);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const uazapiConns = connections.filter((c) => c.type === "uazapi");
  const wabaConns   = connections.filter((c) => c.type === "meta");

  const [form, setForm] = useState<FormState>(
    BLANK_FORM(uazapiConns[0]?.id ?? "", approvedTemplates[0]?.id ?? "")
  );

  const selectedFunnel = funnels.find((f) => f.id === form.funnelId);
  const availableConns = form.channel === "uazapi" ? uazapiConns : wabaConns;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleChannelChange(ch: CrmChannel) {
    const conns = ch === "uazapi" ? uazapiConns : wabaConns;
    setForm((f) => ({ ...f, channel: ch, connectionId: conns[0]?.id ?? "" }));
  }

  function openNew() {
    setEditingId(null);
    setForm(BLANK_FORM(uazapiConns[0]?.id ?? "", approvedTemplates[0]?.id ?? ""));
    setShowForm(true);
  }

  function openEdit(auto: CrmAutomation) {
    setEditingId(auto.id);
    setForm({
      name: auto.name,
      trigger: auto.trigger,
      funnelId: auto.funnelId ?? "",
      triggerColumnId: auto.triggerColumnId ?? "",
      channel: auto.channel,
      connectionId: auto.connectionId,
      message: auto.message ?? "",
      templateId: auto.templateId ?? approvedTemplates[0]?.id ?? "",
      templateVariables: auto.templateVariables ?? {},
      delayMinutes: auto.delayMinutes,
    });
    setShowForm(true);
    // scroll to form
    setTimeout(() => document.getElementById("crm-form")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function save() {
    if (!form.name.trim() || !form.connectionId) return;
    if (form.channel === "uazapi" && !form.message.trim()) return;
    if (form.channel === "waba" && !form.templateId) return;
    setSaving(true);

    const payload = {
      clientId,
      name: form.name.trim(),
      trigger: form.trigger,
      funnelId: form.funnelId || undefined,
      triggerColumnId: form.trigger === "column_changed" ? form.triggerColumnId || undefined : undefined,
      channel: form.channel,
      connectionId: form.connectionId,
      message: form.channel === "uazapi" ? form.message : undefined,
      templateId: form.channel === "waba" ? form.templateId : undefined,
      templateVariables: form.channel === "waba" && Object.keys(form.templateVariables).length > 0
        ? form.templateVariables : undefined,
      delayMinutes: form.delayMinutes,
    };

    if (editingId) {
      // Editar existente
      const res = await fetch(`/api/crm/automations/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json() as CrmAutomation;
        setAutomations((prev) => prev.map((a) => a.id === editingId ? updated : a));
        closeForm();
      }
    } else {
      // Criar novo
      const res = await fetch("/api/crm/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, active: true }),
      });
      if (res.ok) {
        const created = await res.json() as CrmAutomation;
        setAutomations((prev) => [...prev, created]);
        closeForm();
      }
    }
    setSaving(false);
  }

  async function toggleActive(auto: CrmAutomation) {
    setToggling(auto.id);
    const res = await fetch(`/api/crm/automations/${auto.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !auto.active }),
    });
    if (res.ok) {
      const updated = await res.json() as CrmAutomation;
      setAutomations((prev) => prev.map((a) => a.id === auto.id ? updated : a));
    }
    setToggling(null);
  }

  async function remove(id: string) {
    if (!confirm("Deletar esta automação?")) return;
    setDeleting(id);
    await fetch(`/api/crm/automations/${id}`, { method: "DELETE" });
    setAutomations((prev) => prev.filter((a) => a.id !== id));
    if (editingId === id) closeForm();
    setDeleting(null);
  }

  const uazapiList = automations.filter((a) => a.channel === "uazapi");
  const wabaList   = automations.filter((a) => a.channel === "waba");

  function AutoCard({ auto }: { auto: CrmAutomation }) {
    const funnel = funnels.find((f) => f.id === auto.funnelId);
    const col = funnel?.columns.find((c) => c.id === auto.triggerColumnId);
    const tpl = approvedTemplates.find((t) => t.id === auto.templateId);
    const conn = connections.find((c) => c.id === auto.connectionId);
    const isEditing = editingId === auto.id;

    return (
      <div className={clsx(
        "rounded-xl border p-4 transition",
        isEditing ? "border-violet-300 bg-violet-50" :
        auto.active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-slate-800 text-sm">{auto.name}</span>
              <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", CHANNEL_STYLE[auto.channel])}>
                {CHANNEL_LABEL[auto.channel]}
              </span>
              <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold",
                auto.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                {auto.active ? "Ativa" : "Pausada"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-1">
              <span className="font-medium">{TRIGGER_LABEL[auto.trigger]}</span>
              {funnel && <> · funil <span className="font-medium">{funnel.name}</span></>}
              {col && <> · coluna <span className="font-medium">{col.label}</span></>}
              {auto.delayMinutes > 0 && <> · <span className="font-medium">
                {DELAY_OPTIONS.find((d) => d.value === auto.delayMinutes)?.label ?? `${auto.delayMinutes}min de delay`}
              </span></>}
            </p>
            {auto.channel === "uazapi" && auto.message && (
              <p className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1 line-clamp-2 italic">
                "{auto.message}"
              </p>
            )}
            {auto.channel === "waba" && tpl && (
              <p className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">
                Template: <span className="font-mono font-semibold">{tpl.name}</span>
              </p>
            )}
            {conn && (
              <p className="text-[10px] text-slate-400 mt-1">via {conn.phone} ({conn.funnelName})</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => isEditing ? closeForm() : openEdit(auto)}
              className={clsx(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                isEditing
                  ? "bg-violet-100 text-violet-700 hover:bg-violet-200"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {isEditing ? "✕ Fechar" : "✏ Editar"}
            </button>
            <button
              onClick={() => toggleActive(auto)}
              disabled={toggling === auto.id}
              className={clsx(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                auto.active
                  ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  : "bg-green-100 text-green-700 hover:bg-green-200"
              )}
            >
              {toggling === auto.id ? "..." : auto.active ? "Pausar" : "Ativar"}
            </button>
            <button
              onClick={() => remove(auto.id)}
              disabled={deleting === auto.id}
              className="text-slate-400 hover:text-red-500 transition text-lg leading-none px-1"
              title="Excluir"
            >
              {deleting === auto.id ? "..." : "×"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Automações CRM</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Envios automáticos por UazapiGO (texto livre) ou Meta Oficial (templates aprovados).
          </p>
        </div>
        <button
          onClick={openNew}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition"
        >
          + Nova Automação
        </button>
      </div>

      {/* Formulário de criação / edição */}
      {showForm && (
        <div id="crm-form" className="rounded-xl border border-violet-200 bg-violet-50 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">
            {editingId ? "✏ Editar automação" : "Configurar nova automação"}
          </h2>

          {/* Nome */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nome da Automação</label>
            <input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="ex: Boas-vindas ao cadastro, Follow-up coluna Proposta"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
            />
          </div>

          {/* Trigger */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Gatilho</label>
              <select
                value={form.trigger}
                onChange={(e) => setField("trigger", e.target.value as CrmTrigger)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
              >
                <option value="lead_created">🎯 Lead cadastrado (via formulário)</option>
                <option value="column_changed">↕ Lead muda de coluna</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Funil {form.trigger === "column_changed" ? <span className="text-red-500">*</span> : "(opcional — vazio = todos)"}
              </label>
              <select
                value={form.funnelId}
                onChange={(e) => { setField("funnelId", e.target.value); setField("triggerColumnId", ""); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
              >
                {form.trigger === "column_changed"
                  ? <option value="">— Selecione um funil —</option>
                  : <option value="">Qualquer funil</option>
                }
                {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>

          {/* Coluna alvo (só para column_changed) */}
          {form.trigger === "column_changed" && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Coluna de destino (kanban) {form.funnelId && <span className="text-red-500">*</span>}
              </label>
              {!form.funnelId ? (
                <div className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-slate-50 cursor-not-allowed">
                  ← Selecione um funil primeiro
                </div>
              ) : (
                <select
                  value={form.triggerColumnId}
                  onChange={(e) => setField("triggerColumnId", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
                >
                  <option value="">— Qualquer coluna —</option>
                  {(selectedFunnel?.columns ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Canal */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Canal de envio</label>
            <div className="flex gap-2">
              {(["uazapi", "waba"] as CrmChannel[]).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => handleChannelChange(ch)}
                  className={clsx(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition text-left",
                    form.channel === ch
                      ? ch === "uazapi"
                        ? "border-blue-400 bg-blue-50 text-blue-800"
                        : "border-green-400 bg-green-50 text-green-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {CHANNEL_LABEL[ch]}
                  <p className="text-[10px] font-normal mt-0.5 opacity-70">
                    {ch === "uazapi" ? "Texto livre, informal, sem aprovação" : "Template aprovado pela Meta"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Conexão */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Conexão WhatsApp</label>
            <select
              value={form.connectionId}
              onChange={(e) => setField("connectionId", e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
            >
              {availableConns.length === 0
                ? <option value="">Nenhuma conexão {form.channel === "uazapi" ? "UazapiGO" : "Meta"} configurada</option>
                : availableConns.map((c) => (
                  <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>
                ))
              }
            </select>
          </div>

          {/* Mensagem ou Template */}
          {form.channel === "uazapi" ? (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mensagem</label>
              <textarea
                value={form.message}
                onChange={(e) => setField("message", e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white resize-none"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Variáveis: <code>{"{{nome}}"}</code> <code>{"{{telefone}}"}</code> <code>{"{{email}}"}</code> <code>{"{{funil}}"}</code>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Seletor de template */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Template aprovado</label>
                {approvedTemplates.length === 0 ? (
                  <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-700">
                    Nenhum template aprovado. Acesse <strong>Disparos WA</strong> e importe seus templates do Meta.
                  </div>
                ) : (
                  <select
                    value={form.templateId}
                    onChange={(e) => {
                      setField("templateId", e.target.value);
                      setField("templateVariables", {}); // reset vars ao trocar template
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
                  >
                    {approvedTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Preview + variáveis do template selecionado */}
              {(() => {
                const tpl = approvedTemplates.find((t) => t.id === form.templateId);
                if (!tpl) return null;

                // Componentes que têm variáveis {{n}}
                const varComps = tpl.components.filter(
                  (c) => c.text && /\{\{\d+\}\}/.test(c.text)
                );

                // Componentes de conteúdo (HEADER, BODY, FOOTER) para preview
                const previewComps = tpl.components.filter(
                  (c) => c.type !== "BUTTONS" && c.text
                );

                return (
                  <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                    {/* Preview da mensagem */}
                    <div className="bg-[#e9f5fe] px-3 py-3 space-y-1 border-b border-slate-200">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Pré-visualização</p>
                      {previewComps.map((c) => (
                        <p key={c.type} className={[
                          "text-sm text-slate-800 whitespace-pre-wrap",
                          c.type === "HEADER" ? "font-bold" : "",
                          c.type === "FOOTER" ? "text-slate-400 text-[11px]" : "",
                        ].join(" ")}>
                          {/* Destaca variáveis {{n}} em azul */}
                          {c.text!.split(/(\{\{\d+\}\})/).map((part, i) =>
                            /\{\{\d+\}\}/.test(part)
                              ? <span key={i} className="bg-blue-100 text-blue-700 rounded px-0.5 font-mono">{part}</span>
                              : part
                          )}
                        </p>
                      ))}
                    </div>

                    {/* Inputs para preencher cada variável */}
                    {varComps.length > 0 && (
                      <div className="px-3 py-3 space-y-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                          Preencher variáveis do template
                        </p>
                        {varComps.map((comp) => {
                          const matches = [...comp.text!.matchAll(/\{\{(\d+)\}\}/g)];
                          return (
                            <div key={comp.type}>
                              <p className="text-[10px] font-semibold text-slate-500 mb-1 uppercase">
                                {comp.type === "HEADER" ? "🔝 Header" : "📝 Body"}
                              </p>
                              <div className="space-y-1.5">
                                {matches.map((m) => {
                                  const idx = parseInt(m[1]) - 1;
                                  const current = form.templateVariables[comp.type]?.[idx] ?? "";
                                  return (
                                    <div key={m[1]} className="flex items-center gap-2">
                                      <span className="text-xs font-mono bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 shrink-0">
                                        {`{{${m[1]}}}`}
                                      </span>
                                      <div className="flex-1 relative">
                                        <input
                                          value={current}
                                          onChange={(e) => {
                                            const vars = { ...form.templateVariables };
                                            const arr = [...(vars[comp.type] ?? [])];
                                            arr[idx] = e.target.value;
                                            vars[comp.type] = arr;
                                            setField("templateVariables", vars);
                                          }}
                                          placeholder={`Valor para {{${m[1]}}}`}
                                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white pr-24"
                                        />
                                        {/* Atalhos para variáveis de lead */}
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                                          {["{{nome}}", "{{telefone}}", "{{email}}"].map((v) => (
                                            <button
                                              key={v}
                                              type="button"
                                              onClick={() => {
                                                const vars = { ...form.templateVariables };
                                                const arr = [...(vars[comp.type] ?? [])];
                                                arr[idx] = v;
                                                vars[comp.type] = arr;
                                                setField("templateVariables", vars);
                                              }}
                                              className="rounded bg-slate-100 hover:bg-violet-100 hover:text-violet-700 px-1 py-0.5 text-[9px] font-mono text-slate-500 transition"
                                            >
                                              {v.replace(/\{\{|\}\}/g, "")}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        <p className="text-[10px] text-slate-400">
                          Clique nos atalhos ou digite texto livre. Variáveis disponíveis: <code className="bg-slate-100 px-1 rounded">{"{{nome}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{telefone}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{email}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{funil}}"}</code>
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Delay */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Delay de envio</label>
            <select
              value={form.delayMinutes}
              onChange={(e) => setField("delayMinutes", Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white"
            >
              {DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving || !form.name.trim() || !form.connectionId ||
                (form.channel === "uazapi" && !form.message.trim()) ||
                (form.channel === "waba" && !form.templateId)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition"
            >
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar Automação"}
            </button>
            <button
              onClick={closeForm}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista separada por canal */}
      {automations.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
          <div className="text-4xl mb-2">⚡</div>
          <p className="font-medium">Nenhuma automação criada</p>
          <p className="text-sm mt-1">Configure envios automáticos quando leads chegarem ou mudarem de etapa.</p>
          <button
            onClick={openNew}
            className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Criar primeira automação
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* UazapiGO */}
          {uazapiList.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">🔵 UazapiGO — texto livre</h2>
              <div className="space-y-2">
                {uazapiList.map((a) => <AutoCard key={a.id} auto={a} />)}
              </div>
            </section>
          )}

          {/* Meta Oficial */}
          {wabaList.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">🟢 Meta Oficial — templates aprovados</h2>
              <div className="space-y-2">
                {wabaList.map((a) => <AutoCard key={a.id} auto={a} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
