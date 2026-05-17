"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";

type AdAccount = { id: string; name: string; platform: "meta" | "google" };
type FunnelType = "leads" | "sales" | "traffic";
type Client = {
  id: string;
  name: string;
  email: string;
  color: string;
  cplTarget: number;
  funnelType: FunnelType;
  adAccounts: AdAccount[];
  tintimCode?: string;
  tintimToken?: string;
  tintimWebhookForward?: string;
};

const FUNNEL_OPTIONS: { value: FunnelType; label: string; desc: string; icon: string }[] = [
  { value: "leads",   label: "Funil de Leads",  desc: "Conversas, formulários, CPL", icon: "💬" },
  { value: "sales",   label: "Funil de Vendas",  desc: "Add to cart, checkout, compras, ROAS", icon: "🛒" },
  { value: "traffic", label: "Funil de Tráfego", desc: "Cliques, visitas LP, CPC", icon: "🌐" },
];

const COLORS = ["#3B82F6","#8B5CF6","#EC4899","#F59E0B","#10B981","#EF4444","#06B6D4","#84CC16"];

export function ConfiguracoesView({ clients: initial }: { clients: Client[] }) {
  const router = useRouter();
  const [clients, setClients] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const empty = (): Omit<Client, "id"> & { password: string } => ({
    name: "", email: "", password: "", color: COLORS[0], cplTarget: 25, funnelType: "leads", adAccounts: [],
    tintimCode: "", tintimToken: "", tintimWebhookForward: "",
  });
  const [form, setForm] = useState(empty());

  function openNew() {
    setEditing(null);
    setForm(empty());
    setShowForm(true);
    setError("");
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({ ...c, password: "" });
    setShowForm(true);
    setError("");
  }

  function addAccount() {
    setForm((f) => ({
      ...f,
      adAccounts: [...f.adAccounts, { id: "", name: "", platform: "meta" }],
    }));
  }

  function updateAccount(i: number, field: keyof AdAccount, value: string) {
    setForm((f) => {
      const accs = [...f.adAccounts];
      accs[i] = { ...accs[i], [field]: value };
      return { ...f, adAccounts: accs };
    });
  }

  function removeFormAccount(i: number) {
    setForm((f) => ({ ...f, adAccounts: f.adAccounts.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const url = editing ? `/api/gestor/clients/${editing.id}` : "/api/gestor/clients";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao salvar"); return; }
      router.refresh();
      setShowForm(false);
      const updated = await fetch("/api/gestor/clients").then((r) => r.json());
      setClients(updated);
    } catch {
      setError("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remover este cliente e todas as contas dele?")) return;
    await fetch(`/api/gestor/clients/${id}`, { method: "DELETE" });
    setClients((prev) => prev.filter((c) => c.id !== id));
  }

  async function removeAccount(clientId: string, accountId: string) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const updated = { ...client, adAccounts: client.adAccounts.filter((a) => a.id !== accountId) };
    await fetch(`/api/gestor/clients/${clientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setClients((prev) => prev.map((c) => (c.id === clientId ? updated : c)));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
          <p className="text-sm text-slate-500 mt-1">Gerencie clientes e contas de anúncio</p>
        </div>
        <button
          onClick={openNew}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
        >
          + Novo cliente
        </button>
      </div>

      {/* Client list */}
      <div className="space-y-3">
        {clients.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex items-center gap-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: c.color }}
            >
              {c.name.charAt(0)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-slate-900">{c.name}</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {FUNNEL_OPTIONS.find(f => f.value === c.funnelType)?.icon} {FUNNEL_OPTIONS.find(f => f.value === c.funnelType)?.label ?? "Leads"}
                </span>
                {c.tintimCode && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 font-medium">
                    Tintim ativo
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">{c.email}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.adAccounts.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-2 pr-1 py-0.5 text-xs text-slate-600">
                    {a.platform === "meta" ? "📘" : "🔵"} {a.name}
                    <button
                      onClick={() => removeAccount(c.id, a.id)}
                      title="Remover conta"
                      className="ml-0.5 rounded-full hover:bg-red-100 hover:text-red-600 p-0.5 transition"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => openEdit(c)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition">
                Editar
              </button>
              <button onClick={() => remove(c.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition">
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {editing ? "Editar cliente" : "Novo cliente"}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <Field label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Nome do cliente" />
              <Field label="E-mail de acesso" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="cliente@email.com" />
              <Field label={editing ? "Nova senha (deixe vazio para manter)" : "Senha"} type="password" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="••••••••" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">CPL alvo (R$)</label>
                  <input
                    type="number"
                    value={form.cplTarget}
                    onChange={(e) => setForm((f) => ({ ...f, cplTarget: Number(e.target.value) }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Cor</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setForm((f) => ({ ...f, color }))}
                        className={clsx("h-6 w-6 rounded-full transition", form.color === color ? "ring-2 ring-offset-1 ring-slate-400" : "")}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Funnel type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de funil</label>
                <div className="grid grid-cols-3 gap-2">
                  {FUNNEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, funnelType: opt.value }))}
                      className={clsx(
                        "rounded-lg border p-2.5 text-left transition text-xs",
                        form.funnelType === opt.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 hover:border-slate-300 text-slate-600"
                      )}
                    >
                      <div className="text-base mb-1">{opt.icon}</div>
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-slate-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Ad accounts */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Contas de anúncio</label>
                  <button onClick={addAccount} className="text-xs text-blue-600 hover:underline">+ Adicionar</button>
                </div>
                <div className="space-y-2">
                  {form.adAccounts.map((acc, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <select
                        value={acc.platform}
                        onChange={(e) => updateAccount(i, "platform", e.target.value)}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                      >
                        <option value="meta">Meta</option>
                        <option value="google">Google</option>
                      </select>
                      <input
                        value={acc.name}
                        onChange={(e) => updateAccount(i, "name", e.target.value)}
                        placeholder="Nome da conta"
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                      />
                      <input
                        value={acc.id}
                        onChange={(e) => updateAccount(i, "id", e.target.value)}
                        placeholder="act_XXXXXXX"
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono outline-none focus:border-blue-500"
                      />
                      <button onClick={() => removeFormAccount(i)} className="text-red-400 hover:text-red-600 mt-1.5">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tintim */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Tintim (opcional)</p>
                <Field
                  label="Código do cliente"
                  value={form.tintimCode ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, tintimCode: v }))}
                  placeholder="e8a7482a-87f4-4f50-..."
                />
                <Field
                  label="Token de segurança"
                  value={form.tintimToken ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, tintimToken: v }))}
                  placeholder="q9ifPiV3gfs92D-..."
                />
                <Field
                  label="URL original do webhook (proxy)"
                  value={form.tintimWebhookForward ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, tintimWebhookForward: v }))}
                  placeholder="https://... (URL que estava configurada antes)"
                />
                {editing && (form.tintimCode || editing.tintimCode) && (
                  <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2 space-y-1">
                    <p className="text-xs font-medium text-slate-600">Substitua o webhook no Tintim por esta URL:</p>
                    <code className="text-xs text-emerald-700 break-all block">
                      /api/tintim/webhook?clientId={editing.id}
                    </code>
                    {(form.tintimWebhookForward || editing.tintimWebhookForward) && (
                      <p className="text-xs text-slate-400">
                        O payload sera reencaminhado automaticamente para a URL original.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>
              )}
            </div>

            <div className="border-t border-slate-100 px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition">
                Cancelar
              </button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
      />
    </div>
  );
}
