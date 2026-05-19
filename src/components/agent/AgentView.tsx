"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { useSearchParams } from "next/navigation";

type FollowUpStep = {
  id: string;
  delayHours: number;
  message: string;
  label?: string;
};

type AgentCfg = {
  enabled: boolean;
  followUpEnabled: boolean;
  geminiApiKey?: string;
  googleCalendarId?: string;
  summaryPhone?: string;
  followUps: FollowUpStep[];
  systemPrompt?: string;
  calendarConnected?: boolean;
};

function Toggle({ label, sub, checked, onChange, color = "violet" }: {
  label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
          checked ? (color === "violet" ? "bg-violet-600" : "bg-emerald-500") : "bg-slate-200"
        )}
      >
        <span className={clsx(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )} />
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export function AgentView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const searchParams = useSearchParams();
  const [cfg, setCfg] = useState<AgentCfg>({
    enabled: false, followUpEnabled: false, followUps: [],
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [cronUrl, setCronUrl] = useState("");

  useEffect(() => {
    fetch(`/api/agent?clientId=${clientId}`)
      .then((r) => r.json())
      .then((d) => setCfg(d))
      .catch(() => {});

    if (typeof window !== "undefined") {
      setCronUrl(`${window.location.origin}/api/agent/cron?secret=`);
    }
  }, [clientId]);

  useEffect(() => {
    if (searchParams.get("calendar") === "connected") setMsg("✓ Google Calendar conectado com sucesso!");
    if (searchParams.get("error") === "oauth_failed") setMsg("✗ Falha ao conectar Google Calendar.");
  }, [searchParams]);

  async function toggleField(field: "enabled" | "followUpEnabled", value: boolean) {
    setCfg((c) => ({ ...c, [field]: value }));
    await fetch(`/api/agent?clientId=${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
  }

  async function save() {
    setSaving(true);
    setMsg("");
    const res = await fetch(`/api/agent?clientId=${clientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setSaving(false);
    setMsg(res.ok ? "✓ Salvo com sucesso!" : "✗ Erro ao salvar.");
  }

  function connectCalendar() {
    window.location.href = `/api/agent/google-auth?clientId=${clientId}`;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Agente de IA — {clientName}</h1>
        <p className="text-sm text-slate-500 mt-1">Configure o assistente de WhatsApp com Gemini 2.5 Pro</p>
      </div>

      {msg && (
        <div className={clsx(
          "rounded-xl px-4 py-3 text-sm font-medium border",
          msg.startsWith("✓") ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-600 border-red-200"
        )}>{msg}</div>
      )}

      {/* Toggles principais */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status do Agente</p>
        <Toggle
          label="Agente ativo"
          sub="O agente responde automaticamente no WhatsApp com Gemini 2.5 Pro"
          checked={cfg.enabled}
          onChange={(v) => toggleField("enabled", v)}
          color="violet"
        />
        <div className="border-t border-slate-100" />
        <Toggle
          label="Follow-up automático"
          sub={(cfg.followUps?.length ?? 0) > 0
            ? `${cfg.followUps.length} step${cfg.followUps.length !== 1 ? "s" : ""} configurado${cfg.followUps.length !== 1 ? "s" : ""}`
            : "Nenhum step configurado ainda"}
          checked={cfg.followUpEnabled}
          onChange={(v) => toggleField("followUpEnabled", v)}
          color="green"
        />
      </div>

      {/* Instruções do agente */}
      <div className="rounded-2xl border border-violet-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Instruções do Agente</p>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Como o agente deve se comportar
          </label>
          <textarea
            rows={5}
            value={cfg.systemPrompt ?? ""}
            onChange={(e) => setCfg((c) => ({ ...c, systemPrompt: e.target.value }))}
            placeholder={`Ex:\nVocê é a assistente da Clínica Bem Estar.\nSempre se apresente como "Ana".\nQuando o paciente pedir horário, verifique disponibilidade e confirme nome e telefone.\nSeja gentil e profissional.`}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition resize-none font-mono"
          />
        </div>
        <Field
          label="Chave Gemini API (opcional)"
          value={cfg.geminiApiKey ?? ""}
          onChange={(v) => setCfg((c) => ({ ...c, geminiApiKey: v }))}
          placeholder="AIza..."
          type="password"
          hint="Se vazio, usa a chave global configurada em APIs & Tokens."
        />
      </div>

      {/* Google Calendar */}
      <div className="rounded-2xl border border-blue-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">📅 Google Calendar</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {cfg.calendarConnected ? "✓ Conectado" : "Não conectado"}
            </p>
            <p className="text-xs text-slate-400">
              {cfg.calendarConnected
                ? "O agente pode verificar disponibilidade e criar eventos."
                : "Conecte para habilitar agendamentos automáticos."}
            </p>
          </div>
          <button
            onClick={connectCalendar}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition shrink-0"
          >
            {cfg.calendarConnected ? "Reconectar" : "Conectar Google Calendar"}
          </button>
        </div>
        {cfg.calendarConnected && (
          <Field
            label="Calendar ID"
            value={cfg.googleCalendarId ?? "primary"}
            onChange={(v) => setCfg((c) => ({ ...c, googleCalendarId: v }))}
            placeholder="primary"
            hint='Use "primary" para o calendário principal ou o e-mail da agenda específica.'
          />
        )}
      </div>

      {/* Follow-up sequência */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">⏰ Sequência de Follow-ups</p>
          <button
            onClick={() => {
              const newStep: FollowUpStep = {
                id: crypto.randomUUID(),
                delayHours: 24,
                message: "",
                label: `Follow-up ${(cfg.followUps?.length ?? 0) + 1}`,
              };
              setCfg((c) => ({ ...c, followUps: [...(c.followUps ?? []), newStep] }));
            }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition"
          >
            + Adicionar step
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Cada step é enviado após o prazo configurado. Quando o lead responde, a sequência reinicia do zero.
        </p>

        {(cfg.followUps ?? []).length === 0 && (
          <div className="rounded-xl border border-dashed border-emerald-200 p-4 text-center">
            <p className="text-sm text-slate-400">Nenhum follow-up configurado.</p>
            <p className="text-xs text-slate-300 mt-1">Clique em "+ Adicionar step" para criar a sequência.</p>
          </div>
        )}

        <div className="space-y-3">
          {(cfg.followUps ?? []).map((step, idx) => (
            <div key={step.id} className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shrink-0">
                  {idx + 1}
                </span>
                <input
                  value={step.label ?? ""}
                  onChange={(e) => setCfg((c) => ({
                    ...c,
                    followUps: c.followUps.map((s) => s.id === step.id ? { ...s, label: e.target.value } : s),
                  }))}
                  placeholder={`Follow-up ${idx + 1}`}
                  className="flex-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-sm font-medium outline-none focus:border-emerald-400"
                />
                <button
                  onClick={() => setCfg((c) => ({ ...c, followUps: c.followUps.filter((s) => s.id !== step.id) }))}
                  className="text-slate-300 hover:text-red-500 transition text-sm px-1"
                >✕</button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 shrink-0">
                  {idx === 0 ? "Enviar após" : "Depois de"}
                </span>
                <input
                  type="number"
                  min={1}
                  value={step.delayHours}
                  onChange={(e) => setCfg((c) => ({
                    ...c,
                    followUps: c.followUps.map((s) => s.id === step.id ? { ...s, delayHours: Number(e.target.value) } : s),
                  }))}
                  className="w-20 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-400 text-center"
                />
                <span className="text-xs text-slate-500">
                  {idx === 0 ? "horas sem resposta" : `horas do step ${idx}`}
                </span>
              </div>

              <textarea
                rows={2}
                value={step.message}
                onChange={(e) => setCfg((c) => ({
                  ...c,
                  followUps: c.followUps.map((s) => s.id === step.id ? { ...s, message: e.target.value } : s),
                }))}
                placeholder={`Mensagem do follow-up ${idx + 1}...`}
                className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Resumo */}
      <div className="rounded-2xl border border-amber-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">📋 Resumo de Conversa</p>
        <Field
          label="Número para receber resumos"
          value={cfg.summaryPhone ?? ""}
          onChange={(v) => setCfg((c) => ({ ...c, summaryPhone: v }))}
          placeholder="5511999990000"
          hint="Quando solicitado, o agente envia o resumo da conversa para este número via WhatsApp."
        />
      </div>

      {/* Cron */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">⚙️ Configuração do Cron</p>
        <p className="text-xs text-slate-500">
          Configure no EasyPanel uma tarefa cron a cada 15 minutos chamando:
        </p>
        <div className="rounded-lg bg-slate-800 px-4 py-3">
          <code className="text-xs text-green-400 break-all">
            {cronUrl}<span className="text-yellow-400">SEU_SECRET_AQUI</span>
          </code>
        </div>
        <p className="text-xs text-slate-400">
          Defina <code className="bg-slate-200 px-1 rounded">agentCronSecret</code> em APIs & Tokens para proteger o endpoint.
        </p>
      </div>

      {/* Salvar */}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60 transition"
        >
          {saving ? "Salvando..." : "Salvar configurações"}
        </button>
      </div>
    </div>
  );
}
