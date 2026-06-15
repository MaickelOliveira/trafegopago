"use client";

import { useState } from "react";
import type { Funnel } from "@/lib/funnels";
import type { Employee, EmployeePermissions } from "@/lib/employees";

type SafeEmployee = Omit<Employee, "passwordHash">;

const PERM_LABELS: { key: keyof EmployeePermissions; label: string; desc: string }[] = [
  {
    key: "canDeleteLeads",
    label: "Apagar leads",
    desc: "Permite excluir leads do CRM",
  },
  {
    key: "canManageQR",
    label: "Gerenciar WhatsApp",
    desc: "Pode desconectar / gerar QR Code",
  },
  {
    key: "canViewAutomations",
    label: "Ver Automações",
    desc: "Acessa a aba de Automações",
  },
  {
    key: "canViewCreatives",
    label: "Ver Criativos",
    desc: "Acessa a aba de Criativos",
  },
  {
    key: "canViewAgentIa",
    label: "Ver Agente de IA",
    desc: "Acessa a aba Agente de IA",
  },
  {
    key: "canManageLeadMessages",
    label: "Enviar mensagens",
    desc: "Pode enviar mensagens pelo Inbox",
  },
  {
    key: "canViewWaba",
    label: "Ver Disparos WA",
    desc: "Acessa a aba de Disparos WhatsApp Oficial (templates)",
  },
];

const DEFAULT_PERMS: EmployeePermissions = {
  canDeleteLeads: false,
  canManageQR: false,
  canViewAutomations: false,
  canViewCreatives: true,
  canViewAgentIa: false,
  canManageLeadMessages: true,
  canViewWaba: false,
};

export function FuncionariosView({
  initialEmployees,
  funnels,
}: {
  initialEmployees: SafeEmployee[];
  funnels: Funnel[];
}) {
  const [employees, setEmployees] = useState<SafeEmployee[]>(initialEmployees);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    allowedFunnelIds: [] as string[],
    permissions: { ...DEFAULT_PERMS },
  });

  function resetForm() {
    setForm({ name: "", email: "", password: "", allowedFunnelIds: [], permissions: { ...DEFAULT_PERMS } });
    setShowCreate(false);
    setEditId(null);
    setError(null);
  }

  function openEdit(emp: SafeEmployee) {
    setForm({
      name: emp.name,
      email: emp.email,
      password: "",
      allowedFunnelIds: emp.allowedFunnelIds,
      permissions: { ...DEFAULT_PERMS, ...emp.permissions },
    });
    setEditId(emp.id);
    setShowCreate(false);
  }

  function toggleFunnel(id: string) {
    setForm((f) => ({
      ...f,
      allowedFunnelIds: f.allowedFunnelIds.includes(id)
        ? f.allowedFunnelIds.filter((x) => x !== id)
        : [...f.allowedFunnelIds, id],
    }));
  }

  function toggleAll() {
    setForm((f) => ({
      ...f,
      allowedFunnelIds: f.allowedFunnelIds.includes("*")
        ? []
        : ["*"],
    }));
  }

  function togglePerm(key: keyof EmployeePermissions) {
    setForm((f) => ({
      ...f,
      permissions: { ...f.permissions, [key]: !f.permissions[key] },
    }));
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setError("Nome, e-mail e senha são obrigatórios.");
      return;
    }
    setLoading("create");
    setError(null);
    const res = await fetch("/api/cliente/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) { setError(data.error ?? "Erro ao criar funcionário."); return; }
    setEmployees((prev) => [...prev, data.employee]);
    resetForm();
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setLoading("edit");
    setError(null);
    const body: Record<string, unknown> = {
      name: form.name,
      allowedFunnelIds: form.allowedFunnelIds,
      permissions: form.permissions,
    };
    if (form.password.length >= 6) body.password = form.password;
    const res = await fetch(`/api/cliente/employees/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) { setError(data.error ?? "Erro ao salvar."); return; }
    setEmployees((prev) => prev.map((e) => (e.id === editId ? data.employee : e)));
    resetForm();
  }

  async function toggleBlock(emp: SafeEmployee) {
    setLoading(emp.id);
    const res = await fetch(`/api/cliente/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !emp.active }),
    });
    const data = await res.json();
    setLoading(null);
    if (res.ok) {
      setEmployees((prev) => prev.map((e) => (e.id === emp.id ? data.employee : e)));
    }
  }

  async function handleDelete(emp: SafeEmployee) {
    if (!confirm(`Remover ${emp.name}? Esta ação não pode ser desfeita.`)) return;
    setLoading(emp.id + "-del");
    const res = await fetch(`/api/cliente/employees/${emp.id}`, { method: "DELETE" });
    setLoading(null);
    if (res.ok) {
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
    }
  }

  // ── form panel ──────────────────────────────────────────────────────────────
  const isOpen = showCreate || !!editId;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">👥 Funcionários</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Gerencie quem tem acesso ao portal e com quais permissões.
          </p>
        </div>
        {!isOpen && (
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <span className="text-base leading-none">+</span> Novo funcionário
          </button>
        )}
      </div>

      {/* ── Form ── */}
      {isOpen && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-4">
            {editId ? "✏️ Editar funcionário" : "➕ Novo funcionário"}
          </h2>
          <form onSubmit={editId ? handleUpdate : handleCreate} className="space-y-5">
            {/* Nome + Email + Senha */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nome</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: João Silva"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">E-mail (login)</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="joao@empresa.com"
                  disabled={!!editId}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Senha {editId && <span className="text-slate-400">(deixe em branco para manter)</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editId ? "Nova senha (opcional)" : "Mínimo 6 caracteres"}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Funis */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">Funis permitidos</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleAll}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    form.allowedFunnelIds.includes("*")
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-300 hover:border-blue-400"
                  }`}
                >
                  🌐 Todos os funis
                </button>
                {funnels.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { if (!form.allowedFunnelIds.includes("*")) toggleFunnel(f.id); }}
                    disabled={form.allowedFunnelIds.includes("*")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      form.allowedFunnelIds.includes(f.id) || form.allowedFunnelIds.includes("*")
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                    } disabled:opacity-60`}
                  >
                    {f.name}
                  </button>
                ))}
                {funnels.length === 0 && (
                  <span className="text-xs text-slate-400 italic">Nenhum funil cadastrado ainda.</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                {form.allowedFunnelIds.length === 0 && !form.allowedFunnelIds.includes("*")
                  ? "⚠️ Nenhum funil selecionado — funcionário não verá leads."
                  : form.allowedFunnelIds.includes("*")
                  ? "✅ Acesso a todos os funis atuais e futuros."
                  : `✅ Acesso a ${form.allowedFunnelIds.length} funil(is).`}
              </p>
            </div>

            {/* Permissões */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">Permissões</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PERM_LABELS.map(({ key, label, desc }) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition"
                  >
                    <input
                      type="checkbox"
                      checked={form.permissions[key]}
                      onChange={() => togglePerm(key)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{label}</p>
                      <p className="text-xs text-slate-400">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={loading === "create" || loading === "edit"}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {loading ? "Salvando..." : editId ? "Salvar alterações" : "Criar funcionário"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Employee list ── */}
      {employees.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-slate-200 rounded-xl">
          <div className="text-4xl mb-3">👥</div>
          <h3 className="font-semibold text-slate-700">Nenhum funcionário cadastrado</h3>
          <p className="text-sm text-slate-400 mt-1">
            Clique em &quot;Novo funcionário&quot; para dar acesso à sua equipe.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {employees.map((emp) => {
            const funnelLabels = emp.allowedFunnelIds.includes("*")
              ? ["Todos os funis"]
              : emp.allowedFunnelIds
                  .map((id) => funnels.find((f) => f.id === id)?.name ?? id)
                  .filter(Boolean);
            return (
              <div
                key={emp.id}
                className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-4 min-w-0">
                  {/* Avatar */}
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">{emp.name}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          emp.active
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-red-50 text-red-600 border border-red-200"
                        }`}
                      >
                        {emp.active ? "✅ Ativo" : "🚫 Bloqueado"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{emp.email}</p>
                    {/* Funis */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {funnelLabels.length > 0 ? (
                        funnelLabels.map((label) => (
                          <span
                            key={label}
                            className="rounded-md bg-slate-100 text-slate-600 px-2 py-0.5 text-xs"
                          >
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-md bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 text-xs">
                          ⚠️ Sem funis
                        </span>
                      )}
                    </div>
                    {/* Permissions summary */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {PERM_LABELS.filter(({ key }) => emp.permissions?.[key]).map(({ key, label }) => (
                        <span key={key} className="text-xs text-slate-400">
                          {label}
                        </span>
                      )).reduce((acc: React.ReactNode[], el, i, arr) => {
                        acc.push(el);
                        if (i < arr.length - 1) acc.push(<span key={`sep-${i}`} className="text-slate-300 text-xs">·</span>);
                        return acc;
                      }, [])}
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEdit(emp)}
                    className="text-xs text-slate-500 hover:text-blue-600 px-3 py-1.5 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition"
                  >
                    ✏️ Editar
                  </button>
                  <button
                    onClick={() => toggleBlock(emp)}
                    disabled={loading === emp.id}
                    className={`text-xs px-3 py-1.5 border rounded-lg transition ${
                      emp.active
                        ? "text-amber-600 border-amber-200 hover:bg-amber-50"
                        : "text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                    } disabled:opacity-50`}
                  >
                    {loading === emp.id ? "..." : emp.active ? "🚫 Bloquear" : "✅ Ativar"}
                  </button>
                  <button
                    onClick={() => handleDelete(emp)}
                    disabled={loading === emp.id + "-del"}
                    className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 border border-red-100 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {loading === emp.id + "-del" ? "..." : "🗑️"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
