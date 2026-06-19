"use client";

import { useState, useEffect, useRef } from "react";
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
  type: "uazapi" | "meta" | "wppconnect";
  funnelId: string;
  funnelName: string;
};

type AvisoRecipient = {
  id: string;
  label: string;
  value: string;
  type: "phone" | "group";
};

type AgentCfg = {
  enabled: boolean;
  followUpEnabled: boolean;
  name?: string;
  geminiApiKey?: string;
  googleCalendarId?: string;
  summaryPhone?: string;
  avisos?: AvisoRecipient[];
  followUps: FollowUpStep[];
  followUpContext?: string;
  whatsappConnectionId?: string;
  messageWaitSeconds?: number;
  systemPrompt?: string;
  calendarConnected?: boolean;
  mediaLibrary?: AgentMedia[];
  splitMessages?: boolean;
  maxMessageLength?: number;
  aiResumeKeyword?: string;
  testPhone?: string;
  spreadsheetId?: string;
  spreadsheetName?: string;
  sheetTabName?: string;
  sheetMappings?: { tipo: string; label: string; tabName: string }[];
  appsScriptUrl?: string;
  metaSummaryTemplateName?: string;
};

type SheetTab = { title: string; sheetId: number };

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

  // Google Sheets — planilha de hóspedes/reservas
  const [spreadsheets, setSpreadsheets] = useState<{ id: string; name: string }[]>([]);
  const [loadingSpreadsheets, setLoadingSpreadsheets] = useState(false);
  const [spreadsheetTabs, setSpreadsheetTabs] = useState<SheetTab[]>([]);
  const [spreadsheetHeaders, setSpreadsheetHeaders] = useState<string[] | null>(null);
  const [loadingSpreadsheetInfo, setLoadingSpreadsheetInfo] = useState(false);
  const [spreadsheetError, setSpreadsheetError] = useState("");
  const [manualSpreadsheetInput, setManualSpreadsheetInput] = useState("");
  const [approvedTemplates, setApprovedTemplates] = useState<{ id: string; name: string; category: string; language: string }[]>([]);

  // Avisos
  const [addingAviso, setAddingAviso] = useState(false);
  const [newAviso, setNewAviso] = useState<{ label: string; value: string; type: "phone" | "group" }>({ label: "", value: "", type: "phone" });
  const [wppGroups, setWppGroups] = useState<{ id: string; name: string }[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  async function fetchWppGroups() {
    const wppConn = waConnections.find((c) => c.type === "wppconnect" && (selectedConnId === null || c.id === selectedConnId));
    if (!wppConn) return;
    setLoadingGroups(true);
    setShowGroupPicker(true);
    try {
      const res = await fetch(`/api/whatsapp/wppconnect-manager/${wppConn.id}/groups`);
      if (res.ok) {
        const data = await res.json() as { groups: { id: string; name: string }[] };
        setWppGroups(data.groups);
      }
    } catch { /* ignore */ } finally {
      setLoadingGroups(false);
    }
  }

  // Base de conhecimento
  type KbDoc = { id: string; name: string; filename: string; chars?: number; uploadedAt: number };
  const [kbDocs, setKbDocs] = useState<KbDoc[]>([]);
  const [kbUploading, setKbUploading] = useState(false);
  const [kbMsg, setKbMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const kbFileRef = useRef<HTMLInputElement>(null);

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

  async function loadSpreadsheets(connId?: string | null) {
    const cid = connId !== undefined ? connId : selectedConnId;
    setLoadingSpreadsheets(true);
    try {
      const connParam = cid ? `&connId=${encodeURIComponent(cid)}` : "";
      const res = await fetch(`/api/agent/spreadsheets?clientId=${clientId}${connParam}`);
      const data = await res.json();
      if (res.ok) setSpreadsheets(data.spreadsheets ?? []);
      else setSpreadsheetError(data.error ?? "Erro ao listar planilhas");
    } catch {
      setSpreadsheetError("Falha na conexão");
    }
    setLoadingSpreadsheets(false);
  }

  // Resolve uma planilha (por ID ou link colado), busca suas abas e, se uma
  // aba estiver selecionada (ou for a primeira), busca também o cabeçalho.
  async function loadSpreadsheetInfo(idOrUrl: string, sheetName?: string, connId?: string | null) {
    const cid = connId !== undefined ? connId : selectedConnId;
    setLoadingSpreadsheetInfo(true);
    setSpreadsheetError("");
    try {
      const connParam = cid ? `&connId=${encodeURIComponent(cid)}` : "";
      const sheetParam = sheetName ? `&sheetName=${encodeURIComponent(sheetName)}` : "";
      const res = await fetch(`/api/agent/spreadsheet-info?clientId=${clientId}${connParam}&spreadsheetId=${encodeURIComponent(idOrUrl)}${sheetParam}`);
      const data = await res.json();
      if (!res.ok) {
        setSpreadsheetError(data.error ?? "Erro ao acessar planilha");
        setSpreadsheetTabs([]);
        setSpreadsheetHeaders(null);
        return;
      }
      const tabs: SheetTab[] = data.tabs ?? [];
      setSpreadsheetTabs(tabs);
      const tabName = sheetName ?? tabs[0]?.title ?? "";
      setCfg((c) => ({ ...c, spreadsheetId: data.spreadsheetId, spreadsheetName: data.title, sheetTabName: tabName }));
      if (data.headers) {
        setSpreadsheetHeaders(data.headers);
      } else if (tabName) {
        await loadSpreadsheetInfo(data.spreadsheetId, tabName, cid);
        return;
      } else {
        setSpreadsheetHeaders([]);
      }
    } catch {
      setSpreadsheetError("Falha na conexão");
    } finally {
      setLoadingSpreadsheetInfo(false);
    }
  }

  async function loadConnConfig(connId: string | null) {
    const url = connId
      ? `/api/agent?clientId=${clientId}&connId=${encodeURIComponent(connId)}`
      : `/api/agent?clientId=${clientId}`;
    const res = await fetch(url);
    const d = await res.json();
    // migra summaryPhone legado para avisos[]
    if (d.summaryPhone && !d.avisos?.length) {
      d.avisos = [{ id: "legacy", label: "Gestor", value: d.summaryPhone, type: "phone" }];
    }
    setCfg(d);
    if (!connId && d._agentConfigsSummary) setConfigsSummary(d._agentConfigsSummary);
    if (d.calendarConnected) loadCalendars();

    // Reseta estado da seção de planilhas e recarrega preview se já houver uma configurada
    setSpreadsheets([]);
    setSpreadsheetTabs([]);
    setSpreadsheetHeaders(null);
    setSpreadsheetError("");
    setManualSpreadsheetInput("");
    if (d.calendarConnected && d.spreadsheetId) {
      loadSpreadsheetInfo(d.spreadsheetId, d.sheetTabName, connId);
    }

    await loadKbDocs(connId);
  }

  async function loadKbDocs(connId: string | null) {
    const connParam = connId ? `&connId=${encodeURIComponent(connId)}` : "";
    const res = await fetch(`/api/agent/knowledge-base?clientId=${clientId}${connParam}`);
    if (res.ok) {
      const data = await res.json();
      setKbDocs(data.docs ?? []);
    }
  }

  async function uploadKbDoc(file: File, docName: string) {
    setKbUploading(true);
    setKbMsg(null);
    const connParam = selectedConnId ? `&connId=${encodeURIComponent(selectedConnId)}` : "";
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", docName);
    try {
      const res = await fetch(`/api/agent/knowledge-base?clientId=${clientId}${connParam}`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        setKbMsg({ type: "ok", text: `"${data.doc.name}" carregado — ${(data.doc.chars as number).toLocaleString("pt-BR")} caracteres extraídos` });
        await loadKbDocs(selectedConnId);
      } else {
        setKbMsg({ type: "err", text: data.error ?? "Erro ao fazer upload" });
      }
    } catch {
      setKbMsg({ type: "err", text: "Falha na conexão" });
    }
    setKbUploading(false);
  }

  async function deleteKbDoc(docId: string) {
    if (!confirm("Remover este documento da base de conhecimento?")) return;
    const connParam = selectedConnId ? `&connId=${encodeURIComponent(selectedConnId)}` : "";
    const res = await fetch(`/api/agent/knowledge-base/${docId}?clientId=${clientId}${connParam}`, {
      method: "DELETE",
    });
    if (res.ok) await loadKbDocs(selectedConnId);
    else alert("Erro ao remover documento");
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
      // Busca funis do cliente + instâncias enriquecidas do WhatsApp Manager + sessões WPPConnect
      const [funnelsRes, managerRes, wppRes] = await Promise.all([
        fetch(`/api/crm/funnels?clientId=${clientId}`),
        fetch("/api/whatsapp/manager"),
        fetch("/api/whatsapp/wppconnect-manager"),
      ]);
      const funnels: { id: string; name: string; connections?: { id: string; phone?: string; type: string; uazapiToken?: string; metaPhoneNumberId?: string }[] }[] =
        funnelsRes.ok ? await funnelsRes.json() : [];
      // EnrichedInstance array from /api/whatsapp/manager
      type EnrichedInst = { token: string; name: string; status: string; phone: string | null };
      const enrichedList: EnrichedInst[] = managerRes.ok ? await managerRes.json() : [];
      // WPPConnect sessions
      type WppSess = { id: string; sessionName: string; status: string; phone: string | null; linkedFunnelId: string | null; linkedFunnelName: string | null };
      const wppSessions: WppSess[] = wppRes.ok ? await wppRes.json() : [];

      // Lookup by token or name
      const byToken = new Map(enrichedList.map(e => [e.token, e]));
      const byName  = new Map(enrichedList.map(e => [e.name,  e]));

      // Funnel IDs belonging to this client
      const clientFunnelIds = new Set(funnels.map(f => f.id));

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

      // Adiciona sessões WPPConnect vinculadas aos funis do cliente
      for (const wpp of wppSessions) {
        if (wpp.linkedFunnelId && clientFunnelIds.has(wpp.linkedFunnelId)) {
          conns.push({
            id: wpp.id,
            phone: wpp.phone ?? undefined,
            name: wpp.sessionName,
            status: wpp.status,
            type: "wppconnect",
            funnelId: wpp.linkedFunnelId,
            funnelName: wpp.linkedFunnelName ?? "",
          });
        }
      }

      setWaConnections(conns);
      // Auto-seleciona a conexão indicada pelo redirect do OAuth (se existir), senão a primeira
      const redirectConnId = searchParams.get("connId");
      const firstId = (redirectConnId && conns.some((c) => c.id === redirectConnId))
        ? redirectConnId
        : conns[0]?.id ?? null;
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
              const phone = conn.phone ? `+${conn.phone}` : (conn.name ?? conn.id.slice(0, 12));
              const agentName = summary?.name;
              const label = agentName ? `${agentName} (${phone})` : phone;
              const badge = summary?.enabled ? " ✓" : "";
              const icon = conn.type === "meta" ? "📘" : conn.type === "wppconnect" ? "📱" : "⚡";
              return (
                <option key={conn.id} value={conn.id}>
                  {icon} {label}{badge}
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
            const res = await fetch(`/api/agent/test?clientId=${clientId}${connParam}`, { method: "POST" });
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
                ({waConnections.find(c => c.id === selectedConnId)?.type === "meta" ? "Meta API" : waConnections.find(c => c.id === selectedConnId)?.type === "wppconnect" ? "WPPConnect" : "UazAPI"})
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

      {/* Google Sheets — Planilha de hóspedes/reservas */}
      <div className="rounded-2xl border border-teal-200 bg-white p-5 space-y-4 shadow-sm">
        <p className="text-xs font-semibold text-teal-600 uppercase tracking-wide">📊 Planilha do Google Sheets</p>
        <p className="text-xs text-slate-500">
          A IA registra automaticamente uma nova linha na aba correta da planilha conforme o tipo de reserva
          (hospedagem, day use, almoço, etc.), preenchendo as colunas de cada aba.
        </p>

        {!cfg.calendarConnected ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
            Conecte sua conta Google na seção &quot;Google Calendar&quot; acima para selecionar uma planilha.
          </div>
        ) : (
          <>
            {cfg.spreadsheetId && (
              <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 space-y-1">
                <p className="text-sm font-semibold text-slate-800">✓ {cfg.spreadsheetName || cfg.spreadsheetId}</p>
                <a href={`https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-600 underline">
                  Abrir no Google Sheets ↗
                </a>
              </div>
            )}

            {/* Seletor via Google Drive */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Selecionar uma planilha do seu Google Drive</label>
              {spreadsheets.length === 0 ? (
                <button onClick={() => loadSpreadsheets()} disabled={loadingSpreadsheets}
                  className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 transition disabled:opacity-50">
                  {loadingSpreadsheets ? "Carregando..." : "Carregar planilhas do Drive"}
                </button>
              ) : (
                <select value={cfg.spreadsheetId ?? ""}
                  onChange={(e) => { const sp = spreadsheets.find((s) => s.id === e.target.value); if (sp) loadSpreadsheetInfo(sp.id); }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">— selecione uma planilha —</option>
                  {spreadsheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>

            {/* Colar link/ID manualmente */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Ou cole o link/ID da planilha</label>
              <div className="flex gap-2">
                <input value={manualSpreadsheetInput} onChange={(e) => setManualSpreadsheetInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition" />
                <button onClick={() => loadSpreadsheetInfo(manualSpreadsheetInput)}
                  disabled={!manualSpreadsheetInput.trim() || loadingSpreadsheetInfo}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 transition shrink-0">
                  Usar
                </button>
              </div>
            </div>

            {loadingSpreadsheetInfo && <p className="text-xs text-slate-400">Carregando informações da planilha...</p>}
            {spreadsheetError && <p className="text-xs text-red-600">{spreadsheetError}</p>}

            {/* Mapeamento tipo de reserva → aba */}
            {spreadsheetTabs.length > 0 && cfg.spreadsheetId && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Mapeamento: Tipo de Reserva → Aba da Planilha</label>
                  <button
                    onClick={() => setCfg((c) => ({
                      ...c,
                      sheetMappings: [...(c.sheetMappings ?? []), { tipo: `tipo_${Date.now()}`, label: "", tabName: spreadsheetTabs[0]?.title ?? "" }],
                    }))}
                    className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition"
                  >
                    + Adicionar tipo
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  A IA usa o &quot;Nome do tipo&quot; para decidir em qual aba registrar cada reserva. Ex: &quot;Hospedagem&quot; → aba &quot;Pernoite&quot;.
                </p>

                {(cfg.sheetMappings ?? []).length === 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    Nenhum mapeamento configurado. Clique em &quot;+ Adicionar tipo&quot; para configurar cada tipo de reserva.
                  </p>
                )}

                <div className="space-y-2">
                  {(cfg.sheetMappings ?? []).map((m, idx) => (
                    <div key={m.tipo} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-slate-400 mb-0.5">Nome do tipo (label)</p>
                          <input
                            value={m.label}
                            onChange={(e) => setCfg((c) => {
                              const ms = [...(c.sheetMappings ?? [])];
                              ms[idx] = { ...ms[idx], label: e.target.value };
                              return { ...c, sheetMappings: ms };
                            })}
                            placeholder="ex: Hospedagem, Day Use, Almoço..."
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-400"
                          />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 mb-0.5">Aba na planilha</p>
                          <select
                            value={m.tabName}
                            onChange={(e) => setCfg((c) => {
                              const ms = [...(c.sheetMappings ?? [])];
                              ms[idx] = { ...ms[idx], tabName: e.target.value };
                              return { ...c, sheetMappings: ms };
                            })}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-400"
                          >
                            <option value="">— selecione —</option>
                            {spreadsheetTabs.map((t) => <option key={t.sheetId} value={t.title}>{t.title}</option>)}
                          </select>
                        </div>
                      </div>
                      <button
                        onClick={() => setCfg((c) => ({ ...c, sheetMappings: (c.sheetMappings ?? []).filter((_, i) => i !== idx) }))}
                        className="text-slate-400 hover:text-red-500 transition text-lg leading-none px-1 shrink-0"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Apps Script URL — preenchimento gratuito sem consumir tokens do Gemini principal */}
        <div className="space-y-1.5 pt-2 border-t border-slate-100">
          <label className="block text-xs font-semibold text-slate-700">URL do Google Apps Script (opcional)</label>
          <input
            type="url"
            value={cfg.appsScriptUrl ?? ""}
            onChange={(e) => setCfg((c) => ({ ...c, appsScriptUrl: e.target.value || undefined }))}
            placeholder="https://script.google.com/macros/s/…/exec"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <p className="text-[11px] text-slate-400">
            Quando preenchida, a IA deixa de usar a ferramenta de planilha (economizando tokens) e um modelo barato
            extrai os dados da conversa e envia direto para o Apps Script — gratuito, sem OAuth.
          </p>
        </div>
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

        {/* Contexto para análise inteligente do follow-up */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">
            Contexto do negócio para follow-up inteligente
          </label>
          <textarea
            value={cfg.followUpContext ?? ""}
            onChange={(e) => setCfg((c) => ({ ...c, followUpContext: e.target.value }))}
            rows={3}
            placeholder={
              "Ex: Pousada e espaço para eventos. Clientes são pessoas físicas interessadas em hospedagem, day use ou eventos. Não enviar follow-up para fornecedores, candidatos a emprego ou conversas pessoais."
            }
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
          />
          <p className="text-[11px] text-slate-400">
            A IA lê este contexto antes de enviar cada follow-up para decidir se a conversa merece retorno. Seja específico: o que o negócio vende, quem é o cliente ideal, e o que deve ser filtrado.
          </p>
        </div>

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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 shrink-0">
                    {idx === 0 ? "Enviar após" : "Depois de"}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      value={Math.floor(step.delayHours)}
                      onChange={(e) => {
                        const h = Math.max(0, Number(e.target.value));
                        const m = Math.round((step.delayHours % 1) * 60);
                        updateStep({ delayHours: h + m / 60 });
                      }}
                      className="w-14 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-400 text-center"
                    />
                    <span className="text-xs text-slate-500">h</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={Math.round((step.delayHours % 1) * 60)}
                      onChange={(e) => {
                        const m = Math.min(59, Math.max(0, Number(e.target.value)));
                        const h = Math.floor(step.delayHours);
                        updateStep({ delayHours: h + m / 60 });
                      }}
                      className="w-14 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-400 text-center"
                    />
                    <span className="text-xs text-slate-500">
                      {idx === 0 ? "min sem resposta" : `min do step ${idx}`}
                    </span>
                  </div>
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

      {/* Avisos */}
      <div className="rounded-2xl border border-amber-200 bg-white p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">🔔 Avisos</p>
          {!addingAviso && (
            <div className="flex gap-2">
              {waConnections.some((c) => c.type === "wppconnect") && (
                <button
                  onClick={fetchWppGroups}
                  disabled={loadingGroups}
                  className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition disabled:opacity-50"
                >
                  {loadingGroups ? "Carregando..." : "👥 Listar grupos"}
                </button>
              )}
              <button
                onClick={() => { setAddingAviso(true); setNewAviso({ label: "", value: "", type: "phone" }); }}
                className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 transition"
              >
                + Adicionar destinatário
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Quando o agente gerar um aviso ou resumo de conversa, todos os destinatários abaixo receberão a mensagem via WhatsApp.
        </p>

        {/* Seletor de grupos WPPConnect */}
        {showGroupPicker && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
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
            ) : wppGroups.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Nenhum grupo encontrado. Verifique se a sessão está conectada.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {wppGroups.map((g) => {
                  const alreadyAdded = (cfg.avisos ?? []).some((a) => a.value === g.id);
                  return (
                    <button
                      key={g.id}
                      disabled={alreadyAdded}
                      onClick={() => {
                        if (alreadyAdded) return;
                        const id = Math.random().toString(36).slice(2);
                        setCfg((c) => ({ ...c, avisos: [...(c.avisos ?? []), { id, label: g.name, value: g.id, type: "group" }] }));
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
        {(cfg.avisos ?? []).length > 0 && (
          <div className="space-y-2">
            {(cfg.avisos ?? []).map((r) => (
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
                  onClick={() => setCfg((c) => ({ ...c, avisos: (c.avisos ?? []).filter((x) => x.id !== r.id) }))}
                  className="shrink-0 rounded-md px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 transition"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}

        {(cfg.avisos ?? []).length === 0 && !addingAviso && (
          <p className="text-xs text-slate-400 italic">Nenhum destinatário configurado.</p>
        )}

        {/* Formulário de novo destinatário */}
        {addingAviso && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-amber-700">Novo destinatário</p>

            {/* Tipo */}
            <div className="flex gap-2">
              {(["phone", "group"] as const).map((t) => (
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
                  O ID do grupo está no formato <span className="font-mono">120363xxxxxxxx@g.us</span>. Você pode obtê-lo no WhatsApp Web (URL do grupo) ou solicitando ao suporte.
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  if (!newAviso.label.trim() || !newAviso.value.trim()) return;
                  const id = Math.random().toString(36).slice(2);
                  setCfg((c) => ({ ...c, avisos: [...(c.avisos ?? []), { id, ...newAviso }] }));
                  setAddingAviso(false);
                }}
                className="flex-1 rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
              >
                Confirmar
              </button>
              <button
                onClick={() => setAddingAviso(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Template Meta para avisos */}
        <div className="mt-3 space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Template Meta para avisos</label>
          {approvedTemplates.length > 0 ? (
            <select
              value={cfg.metaSummaryTemplateName ?? ""}
              onChange={(e) => setCfg((c) => ({ ...c, metaSummaryTemplateName: e.target.value || undefined }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
            >
              <option value="">— Nenhum (não enviar via template) —</option>
              {approvedTemplates.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name} · {t.category === "MARKETING" ? "📣 Marketing" : "⚙️ Utilidade"} · {t.language}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-slate-50">
              Nenhum template aprovado encontrado.{" "}
              <a href="../disparos-wa" className="text-violet-600 underline hover:text-violet-700">Criar em Disparos WA →</a>
            </div>
          )}
          <p className="text-xs text-slate-400">Para API oficial Meta. O template deve ter 3 variáveis: {"{{"}<span>1</span>{"}}"} = telefone, {"{{"}<span>2</span>{"}}"} = nome, {"{{"}<span>3</span>{"}}"} = resumo.</p>
        </div>
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

      {/* ── Base de Conhecimento ── */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 space-y-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span>📚</span> Base de Conhecimento
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Carregue PDFs ou arquivos TXT com catálogos de produtos, tabelas de preços, scripts de vendas, etc.
              A IA lê esses documentos ao responder — sem precisar colocar tudo no prompt.
            </p>
          </div>
          <button
            onClick={() => kbFileRef.current?.click()}
            disabled={kbUploading}
            className="shrink-0 flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition"
          >
            {kbUploading ? (
              <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Carregando...</>
            ) : (
              <>📤 Adicionar documento</>
            )}
          </button>
          <input
            ref={kbFileRef}
            type="file"
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const docName = prompt(`Nome deste documento na base de conhecimento:\n(ex: "Tabela de Preços", "Cardápio", "Produtos")`, file.name.replace(/\.[^.]+$/, ""));
              if (docName === null) return;
              await uploadKbDoc(file, docName.trim() || file.name);
              e.target.value = "";
            }}
          />
        </div>

        {kbMsg && (
          <div className={clsx(
            "rounded-lg px-3 py-2 text-xs font-medium",
            kbMsg.type === "ok" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          )}>
            {kbMsg.type === "ok" ? "✓" : "✗"} {kbMsg.text}
          </div>
        )}

        {kbDocs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-amber-200 p-6 text-center">
            <p className="text-sm text-slate-400">Nenhum documento carregado.</p>
            <p className="text-xs text-slate-400 mt-1">Formatos suportados: PDF, TXT, MD</p>
          </div>
        ) : (
          <div className="space-y-2">
            {kbDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-white p-3">
                <span className="text-xl shrink-0">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{doc.name}</p>
                  <p className="text-xs text-slate-400">{doc.filename}</p>
                  {doc.chars && (
                    <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                      {doc.chars.toLocaleString("pt-BR")} caracteres extraídos
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteKbDoc(doc.id)}
                  className="text-slate-300 hover:text-red-500 transition text-sm shrink-0 px-1"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-slate-400">
          💡 Dica: documentos muito grandes (acima de 100 mil caracteres) podem tornar a IA mais lenta.
          Prefira textos limpos e organizados para melhor desempenho.
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
