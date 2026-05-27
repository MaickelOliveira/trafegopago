"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { useSearchParams } from "next/navigation";

type FollowUpStep = {
  id: string;
  delayHours: number;
  message: string;
  label?: string;
  messageType?: "text" | "ai" | "template";
  templateId?: string;
  templateCategory?: "MARKETING" | "UTILITY";
  templateVariables?: Record<string, string>;
};

type AgentMedia = {
  id: string;
  name: string;
  type: "image" | "video" | "document";
  url: string;
  caption?: string;
  filename?: string;
  sendOnFirstContact: boolean;
};

type WaConnection = {
  id: string;
  phone?: string;
  name?: string;
  status: string; // "connected" | "connecting" | "disconnected"
  type: "uazapi" | "meta";
  funnelId: string;
  funnelName: string;
};

type AgentCfg = {
  enabled: boolean;
  followUpEnabled: boolean;
  name?: string;
  geminiApiKey?: string;
  googleCalendarId?: string;
  summaryPhone?: string;
  followUps: FollowUpStep[];
  whatsappConnectionId?: string;
  messageWaitSeconds?: number;
  systemPrompt?: string;
  calendarConnected?: boolean;
  mediaLibrary?: AgentMedia[];
  splitMessages?: boolean;
  maxMessageLength?: number;
  aiResumeKeyword?: string;
  testPhone?: string;
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

type ConfigSummary = { whatsappConnectionId?: string; enabled: boolean; followUpEnabled: boolean; name?: string };

export function AgentView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const searchParams = useSearchParams();
  const [cfg, setCfg] = useState<AgentCfg>({
    enabled: false, followUpEnabled: false, followUps: [],
  });
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [configsSummary, setConfigsSummary] = useState<ConfigSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; model?: string; response?: string; error?: string } | null>(null);
  const [cronUrl, setCronUrl] = useState("");
  const [cronSecret, setCronSecret] = useState("");
  const [generatingSecret, setGeneratingSecret] = useState(false);
  const [waConnections, setWaConnections] = useState<WaConnection[]>([]);
  const [loadingWa, setLoadingWa] = useState(false);
  const [addingMedia, setAddingMedia] = useState(false);
  const [newMedia, setNewMedia] = useState<{ type: AgentMedia["type"]; url: string; caption: string; filename: string; sendOnFirstContact: boolean; name: string }>({
    type: "image", url: "", caption: "", filename: "", sendOnFirstContact: true, name: "",
  });
  const [uploading, setUploading] = useState(false);
  const [calendars, setCalendars] = useState<{ id: string; name: string; primary: boolean }[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [approvedTemplates, setApprovedTemplates] = useState<{ id: string; name: string; category: string; language: string }[]>([]);

  async function loadCalendars() {
    setLoadingCalendars(true);
    try {
      const res = await fetch(`/api/agent/calendars?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setCalendars(data.calendars ?? []);
      }
    } catch {}
    setLoadingCalendars(false);
  }

  async function loadConnConfig(connId: string | null) {
    const url = connId
      ? `/api/agent?clientId=${clientId}&connId=${encodeURIComponent(connId)}`
      : `/api/agent?clientId=${clientId}`;
    const res = await fetch(url);
    const d = await res.json();
    setCfg(d);
    if (!connId && d._agentConfigsSummary) setConfigsSummary(d._agentConfigsSummary);
    if (d.calendarConnected) loadCalendars();
  }

  useEffect(() => {
    // Busca o secret do cron existente
    fetch("/api/gestor/config")
      .then((r) => r.json())
      .then((d) => { if (d.agentCronSecret) setCronSecret(d.agentCronSecret); })
      .catch(() => {});

    if (typeof window !== "undefined") {
      setCronUrl(`${window.location.origin}/api/agent/cron?secret=`);
    }

    loadWaConnections();

    // Carrega templates Meta aprovados
    fetch(`/api/waba/templates?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data: { id: string; name: string; category: string; language: string; status: string }[]) => {
        if (Array.isArray(data)) {
          setApprovedTemplates(data.filter((t) => t.status === "APPROVED"));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadWaConnections() {
    setLoadingWa(true);
    try {
      // Busca funis do cliente + instâncias enriquecidas do WhatsApp Manager
      const [funnelsRes, managerRes] = await Promise.all([
        fetch(`/api/crm/funnels?clientId=${clientId}`),
        fetch("/api/whatsapp/manager"),
      ]);
      const funnels: { id: string; name: string; connections?: { id: string; phone?: string; type: string; uazapiToken?: string; metaPhoneNumberId?: string }[] }[] =
        funnelsRes.ok ? await funnelsRes.json() : [];
      // EnrichedInstance array from /api/whatsapp/manager
      type EnrichedInst = { token: string; name: string; status: string; phone: string | null };
      const enrichedList: EnrichedInst[] = managerRes.ok ? await managerRes.json() : [];

      // Lookup by token or name
      const byToken = new Map(enrichedList.map(e => [e.token, e]));
      const byName  = new Map(enrichedList.map(e => [e.name,  e]));

      const conns: WaConnection[] = [];
      for (const funnel of funnels) {
        for (const conn of funnel.connections ?? []) {
          if (conn.type === "uazapi") {
            const inst = byToken.get(conn.uazapiToken ?? "") ?? byName.get(conn.id);
            conns.push({
              id: conn.id,
              phone: inst?.phone ?? conn.phone,
              name: inst?.name,
              status: inst?.status ?? "disconnected",
              type: "uazapi",
              funnelId: funnel.id,
              funnelName: funnel.name,
            });
          } else if (conn.type === "meta") {
            conns.push({
              id: conn.id,
              phone: conn.metaPhoneNumberId,
              status: "connected",
              type: "meta",
              funnelId: funnel.id,
              funnelName: funnel.name,
            });
          }
        }
      }
      setWaConnections(conns);
      // Auto-select first connection
      const firstId = conns[0]?.id ?? null;
      setSelectedConnId(firstId);
      await loadConnConfig(firstId);
    } catch { /* ignore */ } finally {
      setLoadingWa(false);
    }
  }

  async function connectNewNumber() {
    // Redireciona para o painel WhatsApp Manager para conectar novas instâncias
    window.location.href = "/gestor/whatsapp";
  }

  useEffect(() => {
    if (searchParams.get("calendar") === "connected") {
      setMsg("✓ Google Calendar conectado com sucesso!");
      loadCalendars();
    }
    if (searchParams.get("error") === "oauth_failed") setMsg("✗ Falha ao conectar Google Calendar.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function toggleField(field: "enabled" | "followUpEnabled", value: boolean) {
    setCfg((c) => ({ ...c, [field]: value }));
    const connParam = selectedConnId ? `&connId=${encodeURIComponent(selectedConnId)}` : "";
    await fetch(`/api/agent?clientId=${clientId}${connParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    // Update summary badge
    if (selectedConnId) {
      setConfigsSummary(prev => prev.map(s =>
        s.whatsappConnectionId === selectedConnId ? { ...s, [field]: value } : s
      ));
    }
  }

  async function save() {
    setSaving(true);
    setMsg("");
    const connParam = selectedConnId ? `&connId=${encodeURIComponent(selectedConnId)}` : "";
    const body = selectedConnId ? { ...cfg, whatsappConnectionId: selectedConnId } : cfg;
    const res = await fetch(`/api/agent?clientId=${clientId}${connParam}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      setMsg("✓ Salvo com sucesso!");
      // Refresh summary
      if (selectedConnId) {
        setConfigsSummary(prev => {
          const exists = prev.some(s => s.whatsappConnectionId === selectedConnId);
          if (exists) return prev.map(s => s.whatsappConnectionId === selectedConnId ? { ...s, enabled: cfg.enabled, followUpEnabled: cfg.followUpEnabled, name: cfg.name } : s);
          return [...prev, { whatsappConnectionId: selectedConnId, enabled: cfg.enabled, followUpEnabled: cfg.followUpEnabled, name: cfg.name }];
        });
      }
    } else {
      setMsg("✗ Erro ao salvar.");
    }
  }

  function connectCalendar() {
    const connParam = selectedConnId ? `&connId=${encodeURIComponent(selectedConnId)}` : "";
    window.location.href = `/api/agent/google-auth?clientId=${clientId}${connParam}`;
  }

  const selectedConnType = waConnections.find((c) => c.id === selectedConnId)?.type ?? "uazapi";

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      {/* Header com seletor de número no canto direito */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agente de IA — {clientName}</h1>
          <p className="text-sm text-slate-500 mt-1">Configure o assistente de WhatsApp com Gemini 2.5 Pro</p>
        </div>
        {/* Seletor de número */}
        <div className="shrink-0 min-w-[200px]">
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
            Número / Agente
          </label>
          <select
            value={selectedConnId ?? ""}
            onChange={async (e) => {
              const val = e.target.value || null;
              setSelectedConnId(val);
              await loadConnConfig(val);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 font-medium outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
          >
              <option value="">— selecione uma instância —</option>
            {waConnections.map((conn) => {
              const summary = configsSummary.find(s => s.whatsappConnectionId === conn.id);
              const phone = conn.phone ? `+${conn.phone}` : conn.id.slice(0, 12);
              const agentName = summary?.name;
              const label = agentName ? `${agentName} (${phone})` : phone;
              const badge = summary?.enabled ? " ✓" : "";
              return (
                <option key={conn.id} value={conn.id}>
                  {conn.type === "meta" ? "📘" : "⚡"} {label}{badge}
                </option>
              );
            })}
          </select>
          {selectedConnId && (
            <p className="text-[10px] text-slate-400 mt-1">
              Config. salva individualmente para este número
            </p>
          )}
          {loadingWa && <p className="text-[10px] text-slate-400 mt-1">Carregando números...</p>}
        </div>
      </div>

      {msg && (
        <div className={clsx(
          "rounded-xl px-4 py-3 text-sm font-medium border",
          msg.startsWith("✓") ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-600 border-red-200"
        )}>{msg}</div>
      )}

      {/* Teste de conexão */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between shadow-sm">
        <div>
          <p className="text-sm font-semibold text-slate-700">Testar conexão com Gemini</p>
          {testResult && (
            <p className={clsx("text-xs mt-0.5", testResult.ok ? "text-green-600" : "text-red-600")}>
              {testResult.ok
                ? `✓ Funcionando! Modelo: ${testResult.model}`
                : `✗ ${testResult.error}`}
            </p>
          )}
        </div>
        <button
          onClick={async () => {
            setTesting(true);
            setTestResult(null);
            // Salva primeiro para garantir que a chave está salva
            const connParam = selectedConnId ? `&connId=${encodeURIComponent(selectedConnId)}` : "";
            await fetch(`/api/agent?clientId=${clientId}${connParam}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cfg),
            });
            const res = await fetch(`/api/agent/test?clientId=${clientId}`, { method: "POST" });
            const data = await res.json();
            setTestResult(data);
            setTesting(false);
          }}
          disabled={testing}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition shrink-0"
        >
          {testing ? "Testando..." : "Testar agora"}
        </button>
      </div>

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

      {/* Indicador de contexto + link para gerenciar */}
      <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {selectedConnId ? (
            <>
              <span className="text-xs font-semibold text-green-700">
                ✏️ Editando:
              </span>
              <span className="text-xs text-slate-700 font-mono truncate">
                {waConnections.find(c => c.id === selectedConnId)?.phone
                  ? `+${waConnections.find(c => c.id === selectedConnId)?.phone}`
                  : selectedConnId}
              </span>
              <span className="text-[10px] text-slate-400">
                ({waConnections.find(c => c.id === selectedConnId)?.type === "meta" ? "Meta API" : "UazAPI"})
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-400 italic">Nenhuma instância selecionada</span>
          )}
        </div>
        <button
          onClick={connectNewNumber}
          className="text-xs text-violet-600 hover:underline shrink-0 ml-4"
        >
          Gerenciar instâncias →
        </button>
      </div>

      {/* Janela de espera de mensagens — bloco separado */}
      <div className="rounded-2xl border border-orange-200 bg-white p-5 space-y-3 shadow-sm">
        <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">⏱ Janela de Espera de Mensagens</p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={300}
            value={cfg.messageWaitSeconds ?? 0}
            onChange={(e) => setCfg((c) => ({ ...c, messageWaitSeconds: Number(e.target.value) }))}
            className="w-24 rounded-lg border border-orange-200 px-3 py-2 text-sm outline-none focus:border-orange-400 text-center font-semibold"
          />
          <span className="text-sm text-slate-600">segundos</span>
          {(cfg.messageWaitSeconds ?? 0) === 0 && (
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">responde imediatamente</span>
          )}
          {(cfg.messageWaitSeconds ?? 0) > 0 && (
            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded-full border border-orange-200">
              aguarda {cfg.messageWaitSeconds}s antes de responder
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">
          Se o cliente enviar várias mensagens seguidas — "oi", "tudo bem?", "quero saber sobre preços" — o agente
          acumula tudo e responde de uma vez após esse tempo. Recomendado: 15–30 segundos.
        </p>
      </div>

      {/* Pausa e retomada automática da IA */}
      <div className="rounded-2xl border border-amber-200 bg-white p-5 space-y-3 shadow-sm">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">⏸ Pausa Automática da IA</p>
        <p className="text-xs text-slate-500">
          Quando você enviar uma mensagem para o lead, a IA é pausada automaticamente naquela conversa.
          Quando quiser que a IA retome o atendimento, envie a palavra-chave abaixo para o lead — a IA volta a responder.
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Palavra-chave para reativar a IA
          </label>
          <input
            type="text"
            value={cfg.aiResumeKeyword ?? ""}
            onChange={(e) => setCfg((c) => ({ ...c, aiResumeKeyword: e.target.value }))}
            placeholder="Ex: atendimento finalizado"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition"
          />
          <p className="text-xs text-slate-400 mt-1.5">
            Deixe em branco para desativar a retomada automática por palavra-chave (use o sistema para reativar).
          </p>
        </div>
      </div>

      {/* Número de teste */}
      <div className={`rounded-2xl border p-5 space-y-3 shadow-sm ${cfg.testPhone?.trim() ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white"}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${cfg.testPhone?.trim() ? "text-orange-600" : "text-slate-500"}`}>
          🧪 Modo Teste
        </p>
        {cfg.testPhone?.trim() && (
          <div className="flex items-start gap-2 rounded-lg bg-orange-100 border border-orange-300 px-3 py-2">
            <span className="text-orange-600 text-sm font-semibold">⚠️ Ativo</span>
            <span className="text-orange-700 text-xs leading-5">
              A IA está respondendo <strong>apenas</strong> para o número de teste. Limpe o campo para voltar ao modo normal.
            </span>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Número de teste (com DDD e DDI)
          </label>
          <input
            type="text"
            value={cfg.testPhone ?? ""}
            onChange={(e) => setCfg((c) => ({ ...c, testPhone: e.target.value }))}
            placeholder="Ex: 5511999999999"
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition ${cfg.testPhone?.trim() ? "border-orange-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100" : "border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100"}`}
          />
          <p className="text-xs text-slate-400 mt-1.5">
            Quando preenchido, a IA ignora todos os outros números. Deixe vazio para responder normalmente a todos.
          </p>
        </div>
      </div>

      {/* Instruções do agente */}
      <div className="rounded-2xl border border-violet-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Instruções do Agente</p>
        <Field
          label="Nome do agente"
          value={cfg.name ?? ""}
          onChange={(v) => setCfg((c) => ({ ...c, name: v }))}
          placeholder="Ex: Ana — Atendimento Nexo"
          hint="Nome exibido no seletor de número acima para identificar este agente."
        />
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
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-600">Agenda</label>
            {loadingCalendars ? (
              <p className="text-xs text-slate-400">Carregando agendas...</p>
            ) : calendars.length > 0 ? (
              <select
                value={cfg.googleCalendarId ?? "primary"}
                onChange={(e) => setCfg((c) => ({ ...c, googleCalendarId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}{cal.primary ? " (principal)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  value={cfg.googleCalendarId ?? "primary"}
                  onChange={(e) => setCfg((c) => ({ ...c, googleCalendarId: e.target.value }))}
                  placeholder="primary"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={loadCalendars} className="text-xs text-blue-600 underline">Carregar agendas</button>
              </>
            )}
          </div>
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
          {(cfg.followUps ?? []).map((step, idx) => {
            const msgType = step.messageType ?? "text";
            const updateStep = (patch: Partial<FollowUpStep>) =>
              setCfg((c) => ({ ...c, followUps: c.followUps.map((s) => s.id === step.id ? { ...s, ...patch } : s) }));
            const filteredTemplates = step.templateCategory
              ? approvedTemplates.filter((t) => t.category === step.templateCategory)
              : approvedTemplates;

            return (
              <div key={step.id} className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 space-y-3">
                {/* Cabeçalho: número + label + remover */}
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shrink-0">
                    {idx + 1}
                  </span>
                  <input
                    value={step.label ?? ""}
                    onChange={(e) => updateStep({ label: e.target.value })}
                    placeholder={`Follow-up ${idx + 1}`}
                    className="flex-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-sm font-medium outline-none focus:border-emerald-400"
                  />
                  <button
                    onClick={() => setCfg((c) => ({ ...c, followUps: c.followUps.filter((s) => s.id !== step.id) }))}
                    className="text-slate-300 hover:text-red-500 transition text-sm px-1"
                  >✕</button>
                </div>

                {/* Delay */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0">
                    {idx === 0 ? "Enviar após" : "Depois de"}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={step.delayHours}
                    onChange={(e) => updateStep({ delayHours: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-400 text-center"
                  />
                  <span className="text-xs text-slate-500">
                    {idx === 0 ? "horas sem resposta" : `horas do step ${idx}`}
                  </span>
                </div>

                {/* Tipo de mensagem — tabs */}
                <div className="flex gap-1 rounded-lg bg-emerald-100 p-0.5">
                  {(["text", "ai", ...(selectedConnType === "meta" ? ["template"] : [])] as ("text" | "ai" | "template")[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => updateStep({ messageType: t })}
                      className={clsx(
                        "flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
                        msgType === t
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-emerald-600 hover:text-emerald-800"
                      )}
                    >
                      {t === "text" ? "Texto fixo" : t === "ai" ? "✨ IA" : "Template Meta"}
                    </button>
                  ))}
                </div>

                {/* Texto fixo */}
                {msgType === "text" && (
                  <div className="space-y-1.5">
                    <textarea
                      rows={2}
                      value={step.message}
                      onChange={(e) => updateStep({ message: e.target.value })}
                      placeholder={`Mensagem do follow-up ${idx + 1}...`}
                      className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 resize-none"
                    />
                    <div className="flex flex-wrap gap-1">
                      {["{{nome}}", "{{nome_completo}}", "{{telefone}}", "{{email}}"].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => updateStep({ message: step.message + v })}
                          className="rounded bg-white border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-100 px-2 py-0.5 text-[10px] font-mono text-emerald-700 transition"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400">
                      <span className="font-semibold text-emerald-600">{`{{nome}}`}</span> = primeiro nome &nbsp;·&nbsp;
                      <span className="font-semibold text-emerald-600">{`{{nome_completo}}`}</span> = nome completo
                    </p>
                  </div>
                )}

                {/* IA */}
                {msgType === "ai" && (
                  <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 space-y-1">
                    <p className="text-xs font-semibold text-violet-700">✨ Follow-up gerado por Inteligência Artificial</p>
                    <p className="text-xs text-slate-500">
                      No momento do envio, a IA lê o histórico de conversa, analisa o contexto — o que o lead perguntou, onde a conversa parou, o interesse demonstrado — e gera uma mensagem personalizada com o nome da pessoa.
                    </p>
                    <p className="text-[10px] text-violet-400 mt-1">Requer a chave Gemini configurada neste agente.</p>
                  </div>
                )}

                {/* Template Meta */}
                {msgType === "template" && selectedConnType === "meta" && (
                  <div className="space-y-2">
                    {/* Filtro de categoria */}
                    <div className="flex gap-1.5">
                      {([undefined, "MARKETING", "UTILITY"] as const).map((cat) => (
                        <button
                          key={cat ?? "all"}
                          onClick={() => updateStep({ templateCategory: cat })}
                          className={clsx(
                            "rounded-lg px-2.5 py-1 text-xs font-medium border transition",
                            step.templateCategory === cat
                              ? "bg-emerald-600 text-white border-emerald-600"
                              : "bg-white text-slate-500 border-slate-200 hover:border-emerald-400"
                          )}
                        >
                          {cat === undefined ? "Todos" : cat === "MARKETING" ? "Marketing" : "Utilidade"}
                        </button>
                      ))}
                    </div>

                    {/* Lista de templates */}
                    <div className="space-y-1 max-h-44 overflow-y-auto rounded-lg">
                      {filteredTemplates.length === 0 ? (
                        <p className="text-xs text-slate-400 italic px-1">
                          {approvedTemplates.length === 0
                            ? "Nenhum template aprovado. Importe em Disparos WA."
                            : "Nenhum template nesta categoria."}
                        </p>
                      ) : (
                        filteredTemplates.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={() => updateStep({ templateId: tpl.id })}
                            className={clsx(
                              "w-full text-left rounded-lg px-3 py-2 text-sm border transition",
                              step.templateId === tpl.id
                                ? "bg-emerald-600 text-white border-emerald-600"
                                : "bg-white border-slate-200 hover:border-emerald-400 text-slate-700"
                            )}
                          >
                            <div className="font-medium">{tpl.name}</div>
                            <div className={clsx("text-[10px] mt-0.5", step.templateId === tpl.id ? "text-emerald-100" : "text-slate-400")}>
                              {tpl.category} · {tpl.language}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">⚙️ Agendador Interno</p>
          {!cronSecret && (
            <button
              onClick={async () => {
                setGeneratingSecret(true);
                const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
                  .map((b) => b.toString(16).padStart(2, "0")).join("");
                const res = await fetch("/api/gestor/config");
                const cfg = await res.json();
                await fetch("/api/gestor/config", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...cfg, agentCronSecret: secret }),
                });
                setCronSecret(secret);
                setGeneratingSecret(false);
              }}
              disabled={generatingSecret}
              className="rounded-lg bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600 transition disabled:opacity-50"
            >
              {generatingSecret ? "Gerando..." : "Gerar chave secreta"}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-semibold text-green-700">✓ Cron automático ativo</p>
          <p className="text-xs text-green-600 mt-0.5">
            O agendador roda internamente a cada minuto — sem configuração no EasyPanel.
            Follow-ups e mensagens em espera são processados automaticamente.
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Caso queira acionar manualmente ou monitorar externamente, use a URL abaixo:
        </p>
        {cronSecret ? (
          <div className="relative rounded-lg bg-slate-800 px-4 py-3">
            <code className="text-xs text-green-400 break-all">{cronUrl}{cronSecret}</code>
            <button
              onClick={() => navigator.clipboard.writeText(`${cronUrl}${cronSecret}`)}
              className="absolute top-2 right-2 rounded bg-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-500"
            >
              Copiar
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">Gere uma chave acima para ter a URL de acionamento manual.</p>
        )}
      </div>

      {/* Divisão inteligente de mensagens */}
      <div className="rounded-2xl border border-purple-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">✂️ Divisão de Mensagens</p>
        <Toggle
          label="Dividir respostas longas"
          sub="O agente quebra a resposta em várias mensagens curtas, simulando digitação humana"
          checked={cfg.splitMessages ?? false}
          onChange={(v) => setCfg((c) => ({ ...c, splitMessages: v }))}
          color="violet"
        />
        {cfg.splitMessages && (
          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm text-slate-600 shrink-0">Máx. por mensagem</span>
            <input
              type="number"
              min={100}
              max={1000}
              step={50}
              value={cfg.maxMessageLength ?? 300}
              onChange={(e) => setCfg((c) => ({ ...c, maxMessageLength: Number(e.target.value) }))}
              className="w-24 rounded-lg border border-purple-200 px-3 py-2 text-sm outline-none focus:border-purple-400 text-center font-semibold"
            />
            <span className="text-sm text-slate-600">caracteres</span>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Divide parágrafos, depois frases — nunca corta palavras ao meio. Recomendado: 250–400 caracteres.
        </p>
      </div>

      {/* Biblioteca de Mídia */}
      <div className="rounded-2xl border border-rose-200 bg-white p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-rose-600 uppercase tracking-wide">📎 Mídia do Agente</p>
          <button
            onClick={() => setAddingMedia((v) => !v)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition"
          >
            {addingMedia ? "Cancelar" : "+ Adicionar"}
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Fotos, vídeos e documentos que o agente dispara automaticamente quando um novo lead entra em contato.
        </p>

        {/* Formulário para adicionar mídia */}
        {addingMedia && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 space-y-3">
            {/* Tipo */}
            <div className="flex gap-2">
              {(["image", "video", "document"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNewMedia((m) => ({ ...m, type: t }))}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    newMedia.type === t ? "bg-rose-600 text-white" : "bg-white border border-rose-200 text-slate-600 hover:border-rose-400"
                  )}
                >
                  {t === "image" ? "🖼 Imagem" : t === "video" ? "🎬 Vídeo" : "📄 Documento"}
                </button>
              ))}
            </div>

            {/* Nome de referência */}
            <input
              type="text"
              value={newMedia.name}
              onChange={(e) => setNewMedia((m) => ({ ...m, name: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
              placeholder="Nome de referência (ex: catalogo-produtos)"
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400 font-mono"
            />
            <p className="text-[11px] text-slate-400 -mt-2">
              A IA usará este nome para enviar a mídia: <span className="font-mono text-rose-600">[MIDIA:{newMedia.name || "nome"}]</span>
            </p>

            {/* Upload de arquivo OU URL */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <div
                  className={clsx("relative flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 transition cursor-pointer w-full",
                    uploading ? "border-rose-300 bg-rose-50" : "border-rose-200 hover:border-rose-400 bg-white"
                  )}
                >
                  <input
                    type="file"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept={newMedia.type === "image" ? "image/*" : newMedia.type === "video" ? "video/mp4" : ".pdf,.doc,.docx,.xlsx"}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploading(true);
                      try {
                        const fd = new FormData();
                        fd.append("file", file);
                        const res = await fetch("/api/upload", { method: "POST", body: fd });
                        const data = await res.json() as { url?: string; error?: string };
                        if (data.url) {
                          setNewMedia((m) => ({
                            ...m,
                            url: data.url!,
                            filename: m.filename || file.name,
                            name: m.name || file.name.split(".")[0].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                          }));
                        }
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                  <span className="text-sm text-slate-500">
                    {uploading ? "⏳ Enviando..." : "📁 Subir do computador"}
                  </span>
                </div>
              </label>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-px flex-1 bg-rose-100" />
                ou cole a URL
                <span className="h-px flex-1 bg-rose-100" />
              </div>

              <input
                type="url"
                value={newMedia.url}
                onChange={(e) => setNewMedia((m) => ({ ...m, url: e.target.value }))}
                placeholder="https://... URL pública do arquivo"
                className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400"
              />
            </div>

            {newMedia.url && (
              <p className="text-[11px] text-green-600 font-mono break-all">✓ {newMedia.url}</p>
            )}

            {/* Legenda */}
            <input
              type="text"
              value={newMedia.caption}
              onChange={(e) => setNewMedia((m) => ({ ...m, caption: e.target.value }))}
              placeholder="Legenda (opcional)"
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400"
            />

            {/* Nome do arquivo para documento */}
            {newMedia.type === "document" && (
              <input
                type="text"
                value={newMedia.filename}
                onChange={(e) => setNewMedia((m) => ({ ...m, filename: e.target.value }))}
                placeholder="Nome exibido (ex: catalogo.pdf)"
                className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400"
              />
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newMedia.sendOnFirstContact}
                  onChange={(e) => setNewMedia((m) => ({ ...m, sendOnFirstContact: e.target.checked }))}
                  className="accent-rose-600"
                />
                <span className="text-sm text-slate-700">Enviar no primeiro contato do lead</span>
              </label>
              <button
                onClick={() => {
                  if (!newMedia.url || !newMedia.name) return;
                  const item: AgentMedia = {
                    id: crypto.randomUUID(),
                    name: newMedia.name,
                    type: newMedia.type,
                    url: newMedia.url,
                    caption: newMedia.caption || undefined,
                    filename: newMedia.filename || undefined,
                    sendOnFirstContact: newMedia.sendOnFirstContact,
                  };
                  setCfg((c) => ({ ...c, mediaLibrary: [...(c.mediaLibrary ?? []), item] }));
                  setNewMedia({ type: "image", url: "", caption: "", filename: "", sendOnFirstContact: true, name: "" });
                  setAddingMedia(false);
                }}
                disabled={!newMedia.url || !newMedia.name}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 transition"
              >
                Salvar mídia
              </button>
            </div>
          </div>
        )}

        {/* Lista de mídias */}
        {(cfg.mediaLibrary ?? []).length === 0 && !addingMedia && (
          <div className="rounded-xl border border-dashed border-rose-200 p-4 text-center">
            <p className="text-sm text-slate-400">Nenhuma mídia configurada.</p>
          </div>
        )}

        <div className="space-y-2">
          {(cfg.mediaLibrary ?? []).map((m) => (
            <div key={m.id} className="flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50 p-3">
              <span className="text-lg shrink-0">
                {m.type === "image" ? "🖼" : m.type === "video" ? "🎬" : "📄"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800 font-mono">[MIDIA:{m.name}]</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {m.type === "image" ? "imagem" : m.type === "video" ? "vídeo" : "documento"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">{m.url}</p>
                {m.caption && <p className="text-xs text-slate-500 italic">{m.caption}</p>}
                {m.filename && <p className="text-xs text-slate-400">{m.filename}</p>}
                {m.sendOnFirstContact && (
                  <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">
                    ● dispara no 1º contato
                  </span>
                )}
              </div>
              <button
                onClick={() => setCfg((c) => ({ ...c, mediaLibrary: (c.mediaLibrary ?? []).filter((x) => x.id !== m.id) }))}
                className="text-slate-300 hover:text-red-500 transition text-sm px-1 shrink-0"
              >✕</button>
            </div>
          ))}
        </div>
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
