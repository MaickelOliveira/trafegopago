import { useState } from "react";
import { clsx } from "clsx";
import type { AvisoRecipient } from "@/lib/clients";
import { normalizeRecipient } from "@/lib/lead-recipient";

type Props = {
  title: string;
  description: string;
  recipients: AvisoRecipient[];
  onChange: (recipients: AvisoRecipient[]) => void;
  groupsUrl?: string;
  allowGroups?: boolean;
};

export function RecipientList({ title, description, recipients, onChange, groupsUrl, allowGroups = true }: Props) {
  const [addingAviso, setAddingAviso] = useState(false);
  const [newAviso, setNewAviso] = useState<{ label: string; value: string; type: "phone" | "group" }>({ label: "", value: "", type: "phone" });
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  const [error, setError] = useState("");

  async function fetchGroups() {
    if (!groupsUrl) return;
    setError("");
    setGroups([]);
    setLoadingGroups(true);
    setShowGroupPicker(true);
    try {
      const res = await fetch(groupsUrl);
      if (!res.ok) throw new Error();
      const data = await res.json() as { groups: { id: string; name: string }[] };
      setGroups(data.groups);
    } catch { setError("Falha ao carregar os grupos desta conexão."); } finally {
      setLoadingGroups(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">{title}</p>
        {!addingAviso && (
          <div className="flex gap-2">
            {groupsUrl && allowGroups && (
              <button
                onClick={fetchGroups}
                disabled={loadingGroups}
                className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition disabled:opacity-50"
              >
                {loadingGroups ? "Carregando..." : "👥 Listar grupos"}
              </button>
            )}
            <button
              onClick={() => { setError(""); setAddingAviso(true); setNewAviso({ label: "", value: "", type: "phone" }); }}
              className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 transition"
            >
              + Adicionar destinatário
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        {description}
      </p>

      {/* Seletor de grupos */}
      {showGroupPicker && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-violet-700">👥 Selecione um grupo para adicionar</p>
            <button
              onClick={() => setShowGroupPicker(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Fechar
            </button>
          </div>
          {loadingGroups ? (
            <p className="text-xs text-slate-400">Carregando grupos...</p>
          ) : groups.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Nenhum grupo encontrado. Verifique se a sessão está conectada.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {groups.map((g) => {
                const alreadyAdded = recipients.some((a) => a.value === g.id);
                return (
                  <button
                    key={g.id}
                    disabled={alreadyAdded}
                    onClick={() => {
                      if (alreadyAdded) return;
                      const id = Math.random().toString(36).slice(2);
                      onChange([...recipients, { id, label: g.name, value: g.id, type: "group" }]);
                      setShowGroupPicker(false);
                    }}
                    className={clsx(
                      "w-full text-left rounded-lg border px-3 py-2 text-sm transition",
                      alreadyAdded
                        ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-white border-violet-200 text-slate-700 hover:border-violet-500 hover:bg-violet-50"
                    )}
                  >
                    <span className="font-medium">{g.name}</span>
                    {alreadyAdded && <span className="ml-2 text-[10px] text-slate-400">já adicionado</span>}
                    <span className="block text-[10px] text-slate-400 font-mono mt-0.5 truncate">{g.id}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lista de destinatários */}
      {recipients.length > 0 && (
        <div className="space-y-2">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className={clsx(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                r.type === "group" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
              )}>
                {r.type === "group" ? "Grupo" : "Número"}
              </span>
              <span className="flex-1 text-sm font-medium text-slate-700 truncate">{r.label}</span>
              <span className="text-xs text-slate-400 font-mono truncate max-w-[160px]">{r.value}</span>
              <button
                onClick={() => onChange(recipients.filter((x) => x.id !== r.id))}
                className="shrink-0 rounded-md px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 transition"
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}

      {recipients.length === 0 && !addingAviso && (
        <p className="text-xs text-slate-400 italic">Nenhum destinatário configurado.</p>
      )}

      {/* Formulário de novo destinatário */}
      {addingAviso && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-amber-700">Novo destinatário</p>

          {/* Tipo */}
          <div className="flex gap-2">
            {(["phone", "group"] as const).filter((t) => allowGroups || t === "phone").map((t) => (
              <button
                key={t}
                onClick={() => setNewAviso((a) => ({ ...a, type: t }))}
                className={clsx(
                  "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition",
                  newAviso.type === t
                    ? "bg-amber-500 border-amber-500 text-white"
                    : "bg-white border-slate-200 text-slate-600 hover:border-amber-400"
                )}
              >
                {t === "phone" ? "📱 Número" : "👥 Grupo WhatsApp"}
              </button>
            ))}
          </div>

          {/* Label */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rótulo</label>
            <input
              type="text"
              value={newAviso.label}
              onChange={(e) => setNewAviso((a) => ({ ...a, label: e.target.value }))}
              placeholder='ex: "Gestor", "Grupo Vendas"'
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Valor */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {newAviso.type === "phone" ? "Número (com DDI)" : "ID do grupo"}
            </label>
            <input
              type="text"
              value={newAviso.value}
              onChange={(e) => setNewAviso((a) => ({ ...a, value: e.target.value }))}
              placeholder={newAviso.type === "phone" ? "5511999990000" : "120363xxxxxxxx@g.us"}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {newAviso.type === "group" && (
              <p className="mt-1 text-[11px] text-slate-400">
                O ID do grupo está no formato <span className="font-mono">120363xxxxxxxx@g.us</span>. Use o identificador do grupo da conexão selecionada.
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                const label = newAviso.label.trim();
                const value = normalizeRecipient(newAviso.type, newAviso.value);
                if (!label || !value) {
                  setError("Preencha o nome e um número com DDI ou ID de grupo válido.");
                  return;
                }
                if (recipients.some((r) => normalizeRecipient(r.type, r.value) === value)) {
                  setError("Este destinatário já está na lista.");
                  return;
                }
                setError("");
                const id = Math.random().toString(36).slice(2);
                onChange([...recipients, { id, type: newAviso.type, label, value }]);
                setAddingAviso(false);
              }}
              className="flex-1 rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
            >
              Confirmar
            </button>
            <button
              onClick={() => { setError(""); setAddingAviso(false); }}
              className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
