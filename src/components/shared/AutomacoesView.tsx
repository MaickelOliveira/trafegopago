"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { AUTOMATIONS, type AutomationKey, type AutomationSettings, type AutomationsConfig } from "@/lib/automations";

interface ClientData {
  id: string;
  name: string;
  color: string;
  cplTarget: number;
  whatsappPhone?: string;
  automations?: AutomationsConfig;
}

interface Props {
  client: ClientData;
  role: "manager" | "client";
}

const DAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function AutomacoesView({ client, role }: Props) {
  const [phone, setPhone] = useState(client.whatsappPhone ?? "");
  const [automations, setAutomations] = useState<AutomationsConfig>(client.automations ?? {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function get(key: AutomationKey): AutomationSettings {
    return automations[key] ?? { enabled: false };
  }

  function patch(key: AutomationKey, changes: Partial<AutomationSettings>) {
    setAutomations((prev) => ({ ...prev, [key]: { ...get(key), ...changes } }));
  }

  function toggle(key: AutomationKey) {
    const s = get(key);
    if (role === "manager") {
      patch(key, { enabled: !s.enabled });
    } else {
      const current = s.clientEnabled ?? true;
      patch(key, { clientEnabled: !current });
    }
  }

  function isOn(key: AutomationKey): boolean {
    const s = get(key);
    if (role === "manager") return s.enabled;
    if (!s.enabled) return false;
    return s.clientEnabled !== false;
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const url = role === "manager" ? `/api/gestor/clients/${client.id}` : `/api/automations`;
      const method = role === "manager" ? "PUT" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappPhone: phone, automations }),
      });
      if (!res.ok) { setError("Erro ao salvar"); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-bold text-white shrink-0"
          style={{ backgroundColor: client.color }}
        >
          {client.name.charAt(0)}
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Automações</h1>
          {role === "manager" && <p className="text-sm text-slate-500">{client.name}</p>}
        </div>
      </div>

      {/* Phone number */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">📱</span>
          <h2 className="font-semibold text-slate-900 text-sm">Número WhatsApp</h2>
        </div>
        <p className="text-xs text-slate-400 mb-3">Número que receberá os relatórios e alertas automáticos</p>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+55 (11) 99999-9999"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
        />
      </div>

      {/* Automation cards */}
      <div className="space-y-3 mb-6">
        {AUTOMATIONS.map(({ key, icon, label, description, managerOnly }) => {
          const s = get(key);
          const on = isOn(key);
          const clientLocked = role === "client" && (managerOnly || !s.enabled);

          return (
            <div
              key={key}
              className={clsx(
                "rounded-xl border bg-white p-5 transition",
                on ? "border-blue-200 shadow-sm" : "border-slate-200",
                clientLocked && !s.enabled ? "opacity-50" : ""
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-xl shrink-0 mt-0.5">{icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 text-sm">{label}</p>
                      {role === "client" && managerOnly && s.enabled && (
                        <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                          ativado pelo gestor
                        </span>
                      )}
                      {role === "client" && !s.enabled && (
                        <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                          não habilitado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
                  </div>
                </div>

                {/* Toggle */}
                {!clientLocked ? (
                  <button
                    onClick={() => toggle(key)}
                    aria-label={on ? "Desativar" : "Ativar"}
                    className={clsx(
                      "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
                      on ? "bg-blue-600" : "bg-slate-200"
                    )}
                  >
                    <span
                      className={clsx(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                        on ? "translate-x-4" : "translate-x-0.5"
                      )}
                    />
                  </button>
                ) : (
                  <div className="relative h-5 w-9 shrink-0 rounded-full bg-slate-200 opacity-50">
                    <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow" />
                  </div>
                )}
              </div>

              {/* Manager config — shown when enabled */}
              {role === "manager" && on && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-4">
                  {key === "dailyReport" && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      Horário de envio
                      <input
                        type="time"
                        value={s.time ?? "08:00"}
                        onChange={(e) => patch(key, { time: e.target.value })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                    </label>
                  )}
                  {key === "weeklySummary" && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      Dia da semana
                      <select
                        value={s.dayOfWeek ?? 1}
                        onChange={(e) => patch(key, { dayOfWeek: Number(e.target.value) })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500"
                      >
                        {DAYS.map((d, i) => (
                          <option key={i} value={i}>{d}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {key === "highCplAlert" && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      Alertar quando CPL ultrapassar
                      <input
                        type="number"
                        min={10}
                        max={300}
                        value={s.threshold ?? 30}
                        onChange={(e) => patch(key, { threshold: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                      <span>% do alvo (R$ {client.cplTarget})</span>
                    </label>
                  )}
                  {key === "budgetAlert" && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      Alertar quando
                      <input
                        type="number"
                        min={50}
                        max={100}
                        value={s.budgetPct ?? 80}
                        onChange={(e) => patch(key, { budgetPct: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                      <span>% do orçamento diário for consumido</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className={clsx(
            "rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition",
            saved ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700",
            saving && "opacity-60 cursor-not-allowed"
          )}
        >
          {saving ? "Salvando..." : saved ? "✓ Salvo!" : "Salvar configurações"}
        </button>
      </div>

      <p className="mt-5 text-center text-xs text-slate-400">
        🚀 Envio via WhatsApp em breve — configure agora para ativar quando disponível
      </p>
    </div>
  );
}
