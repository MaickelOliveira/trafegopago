"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { WabaTemplate } from "@/lib/waba-templates";
import type { Funnel } from "@/lib/funnels";

type MetaConnection = {
  id: string;
  phone: string;
  phoneNumberId: string;
  token: string;
  funnelName: string;
};

type Props = {
  clientId: string;
  initialTemplates: WabaTemplate[];
  metaConnections: MetaConnection[];
  funnels: Funnel[];
};

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-700",
  PENDING:  "bg-yellow-100 text-yellow-700",
  REJECTED: "bg-red-100 text-red-700",
  PAUSED:   "bg-slate-100 text-slate-600",
  DRAFT:    "bg-blue-100 text-blue-700",
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "✓ Aprovado",
  PENDING:  "⏳ Aguardando Meta",
  REJECTED: "✕ Rejeitado",
  PAUSED:   "⏸ Pausado",
  DRAFT:    "✏️ Rascunho",
};

const CATEGORIES = [
  { value: "MARKETING", label: "Marketing", desc: "Promoções, ofertas, conteúdo" },
  { value: "UTILITY", label: "Utilidade", desc: "Confirmações, lembretes, atualizações" },
];

type Tab = "templates" | "create" | "send" | "profile";

export function WabaView({ clientId, initialTemplates, metaConnections, funnels }: Props) {
  const [templates, setTemplates] = useState<WabaTemplate[]>(initialTemplates);
  const [activeTab, setActiveTab] = useState<Tab>("templates");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Send modal
  const [sendTemplate, setSendTemplate] = useState<WabaTemplate | null>(null);
  const [sendTarget, setSendTarget] = useState<"all" | "phone">("phone");
  const [sendPhone, setSendPhone] = useState("");
  const [sendFunnelId, setSendFunnelId] = useState(funnels[0]?.id ?? "");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; total: number; results?: { phone: string; success: boolean; error?: string }[] } | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string[]>>({});

  // Create form
  const [form, setForm] = useState({
    name: "",
    category: "MARKETING" as "MARKETING" | "UTILITY",
    language: "pt_BR",
    headerText: "",
    bodyText: "",
    footerText: "",
    wabaId: "",
    connId: metaConnections[0]?.id ?? "",
    submitNow: false,
  });
  const [creating, setCreating] = useState(false);
  const [buttons, setButtons] = useState<{type: "QUICK_REPLY"|"URL"|"PHONE_NUMBER"; text: string; url?: string; phone?: string}[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<WabaTemplate | null>(null);
  const [newBtnType, setNewBtnType] = useState<"QUICK_REPLY"|"URL"|"PHONE_NUMBER">("QUICK_REPLY");

  // Import do Meta
  const [showImport, setShowImport] = useState(false);
  const [importWabaId, setImportWabaId] = useState("");
  const [importToken, setImportToken] = useState("");
  const [importConnId, setImportConnId] = useState(metaConnections[0]?.id ?? "");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const selectedConn = metaConnections.find((c) => c.id === form.connId);
  const importConn = metaConnections.find((c) => c.id === importConnId);

  // Foto de perfil do WhatsApp Business
  const [profileConnId, setProfileConnId] = useState(metaConnections[0]?.id ?? "");
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);
  const [profileUploading, setProfileUploading] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const profileConn = metaConnections.find((c) => c.id === profileConnId);

  function handleProfileFileChange(file: File | null) {
    setProfileFile(file);
    setProfileMsg(null);
    if (profilePreview) URL.revokeObjectURL(profilePreview);
    setProfilePreview(file ? URL.createObjectURL(file) : null);
  }

  // Redimensiona/comprime a imagem no navegador antes de enviar — fotos de
  // perfil não precisam de alta resolução, e arquivos grandes (comuns quando
  // baixados do Facebook/Instagram) podem ser cortados pelo proxy do servidor.
  async function compressImage(file: File, maxSize = 640, quality = 0.85): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }

  async function uploadProfilePhoto() {
    if (!profileFile || !profileConn) return;
    setProfileUploading(true);
    setProfileMsg(null);
    const fd = new FormData();
    try {
      const compressed = await compressImage(profileFile);
      fd.append("file", compressed);
    } catch {
      fd.append("file", profileFile);
    }
    fd.append("phoneNumberId", profileConn.phoneNumberId);
    fd.append("token", profileConn.token);
    try {
      const res = await fetch("/api/waba/profile-photo", { method: "POST", body: fd });
      const raw = await res.text();
      let data: { error?: string } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* corpo não-JSON (ex: erro de proxy) */ }
      if (res.ok) {
        setProfileMsg({ type: "ok", text: "Foto de perfil atualizada! Pode levar alguns minutos para refletir no WhatsApp do cliente." });
      } else {
        setProfileMsg({ type: "err", text: data.error ?? `Erro ${res.status}: ${raw.slice(0, 300) || "sem detalhes"}` });
      }
    } catch (e) {
      setProfileMsg({ type: "err", text: `Falha na conexão: ${e instanceof Error ? e.message : String(e)}` });
    }
    setProfileUploading(false);
  }

  async function doImport() {
    const wabaId = importWabaId.trim();
    const token = importToken.trim();
    if (!wabaId || !token) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    const params = new URLSearchParams({ clientId, importWabaId: wabaId, importToken: token });
    if (importConn?.phoneNumberId) params.set("importPhoneId", importConn.phoneNumberId);
    const res = await fetch(`/api/waba/templates?${params}`);
    if (res.ok) {
      const data = await res.json();
      setImportResult({ imported: data.imported });
      setTemplates(data.templates);
    } else {
      const err = await res.json().catch(() => ({}));
      setImportError(err?.error || `Erro ${res.status} — verifique o WABA ID e o token.`);
    }
    setImporting(false);
  }

  async function syncStatus(id: string) {
    setSyncing(id);
    const res = await fetch(`/api/waba/templates/${id}`);
    if (res.ok) {
      const updated = await res.json() as WabaTemplate;
      setTemplates((ts) => ts.map((t) => t.id === id ? updated : t));
    }
    setSyncing(null);
  }

  async function syncAll() {
    setSyncing("all");
    const res = await fetch(`/api/waba/templates?clientId=${clientId}&sync=1`);
    if (res.ok) setTemplates(await res.json());
    setSyncing(null);
  }

  async function submitToMeta(tpl: WabaTemplate) {
    setSubmitting(tpl.id);
    const res = await fetch(`/api/waba/templates/${tpl.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wabaId: form.wabaId || tpl.wabaId, metaToken: selectedConn?.token || tpl.metaToken }),
    });
    if (res.ok) {
      const updated = await res.json() as WabaTemplate;
      setTemplates((ts) => ts.map((t) => t.id === tpl.id ? updated : t));
    }
    setSubmitting(null);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Deletar template?")) return;
    setDeleting(id);
    await fetch(`/api/waba/templates/${id}`, { method: "DELETE" });
    setTemplates((ts) => ts.filter((t) => t.id !== id));
    setDeleting(null);
  }

  function startEdit(tpl: WabaTemplate) {
    const header = tpl.components.find((c) => c.type === "HEADER");
    const body = tpl.components.find((c) => c.type === "BODY");
    const footer = tpl.components.find((c) => c.type === "FOOTER");
    const btnComp = tpl.components.find((c) => c.type === "BUTTONS");
    setForm({
      name: tpl.name,
      category: tpl.category,
      language: tpl.language,
      headerText: header?.text ?? "",
      bodyText: body?.text ?? "",
      footerText: footer?.text ?? "",
      wabaId: tpl.wabaId ?? "",
      connId: metaConnections.find((c) => c.phoneNumberId === tpl.phoneNumberId)?.id ?? metaConnections[0]?.id ?? "",
      submitNow: false,
    });
    setButtons(btnComp?.buttons ?? []);
    setEditingTemplate(tpl);
    setActiveTab("create");
  }

  function resetForm() {
    setForm((f) => ({ ...f, name: "", headerText: "", bodyText: "", footerText: "" }));
    setButtons([]);
    setEditingTemplate(null);
  }

  function addButton() {
    const maxQR = 3, maxURL = 2, maxPhone = 1;
    const counts = { QUICK_REPLY: buttons.filter(b => b.type === "QUICK_REPLY").length, URL: buttons.filter(b => b.type === "URL").length, PHONE_NUMBER: buttons.filter(b => b.type === "PHONE_NUMBER").length };
    if (newBtnType === "QUICK_REPLY" && counts.QUICK_REPLY >= maxQR) return;
    if (newBtnType === "URL" && counts.URL >= maxURL) return;
    if (newBtnType === "PHONE_NUMBER" && counts.PHONE_NUMBER >= maxPhone) return;
    if (buttons.length >= 10) return;
    setButtons((bs) => [...bs, { type: newBtnType, text: "" }]);
  }

  async function createTemplate() {
    if (!form.bodyText.trim()) return;
    if (!editingTemplate && !form.name.trim()) return;
    setCreating(true);
    const components: {type: string; format?: string; text?: string; buttons?: typeof buttons}[] = [];
    if (form.headerText.trim()) components.push({ type: "HEADER", format: "TEXT", text: form.headerText.trim() });
    components.push({ type: "BODY", text: form.bodyText.trim() });
    if (form.footerText.trim()) components.push({ type: "FOOTER", text: form.footerText.trim() });
    if (buttons.length > 0) components.push({ type: "BUTTONS", buttons });

    if (editingTemplate) {
      const res = await fetch(`/api/waba/templates/${editingTemplate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          components,
          category: form.category,
          language: form.language,
          wabaId: form.wabaId || undefined,
          phoneNumberId: selectedConn?.phoneNumberId,
          metaToken: selectedConn?.token,
          submitToMeta: form.submitNow && !!form.wabaId && !!selectedConn,
        }),
      });
      if (res.ok) {
        const updated = await res.json() as WabaTemplate;
        setTemplates((ts) => ts.map((t) => t.id === editingTemplate.id ? updated : t));
        setActiveTab("templates");
        resetForm();
      }
    } else {
      const res = await fetch("/api/waba/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          name: form.name,
          category: form.category,
          language: form.language,
          components,
          wabaId: form.wabaId || undefined,
          phoneNumberId: selectedConn?.phoneNumberId,
          metaToken: selectedConn?.token,
          submitToMeta: form.submitNow && !!form.wabaId && !!selectedConn,
        }),
      });
      if (res.ok) {
        const created = await res.json() as WabaTemplate;
        setTemplates((ts) => [...ts, created]);
        setActiveTab("templates");
        resetForm();
      }
    }
    setCreating(false);
  }

  async function doSend() {
    if (!sendTemplate) return;
    setSending(true);
    setSendResult(null);

    // Monta componentes com as variáveis preenchidas
    const varComps = sendTemplate.components.filter((c) => c.text && /\{\{\d+\}\}/.test(c.text));
    const components = varComps.length > 0
      ? varComps.map((c) => {
          const matches = [...c.text!.matchAll(/\{\{(\d+)\}\}/g)];
          const parameters = matches.map((_, i) => ({ type: "text" as const, text: varValues[c.type]?.[i] ?? "" }));
          return { type: c.type.toLowerCase(), parameters };
        })
      : undefined;

    const res = await fetch("/api/waba/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: sendTemplate.id,
        phones: sendTarget === "phone" ? [sendPhone] : "all",
        clientId,
        funnelId: sendTarget === "all" ? sendFunnelId : undefined,
        components,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setSendResult(data);
    }
    setSending(false);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Disparos WhatsApp Oficial</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Templates de marketing e utilidade via Meta Cloud API — requerem aprovação da Meta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowImport((v) => !v); setImportResult(null); }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition"
          >
            📥 Importar do Meta
          </button>
          <button
            onClick={syncAll}
            disabled={syncing === "all"}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition"
          >
            {syncing === "all" ? "Sincronizando..." : "↻ Sincronizar tudo"}
          </button>
        </div>
      </div>

      {/* Painel de importação */}
      {showImport && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-blue-900 mb-0.5">Importar templates existentes do Meta</p>
            <p className="text-xs text-blue-600">Busca todos os templates aprovados/pendentes do seu WABA e importa aqui.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Conexão WhatsApp</label>
              <select
                value={importConnId}
                onChange={(e) => setImportConnId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white"
              >
                {metaConnections.length === 0
                  ? <option value="">Nenhuma conexão configurada</option>
                  : metaConnections.map((c) => <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>)
                }
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">WABA ID</label>
              <input
                value={importWabaId}
                onChange={(e) => setImportWabaId(e.target.value)}
                placeholder="Ex: 123456789012345"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Token de Acesso Meta <span className="text-red-500">*</span>
              </label>
              <input
                value={importToken}
                onChange={(e) => setImportToken(e.target.value)}
                placeholder="EAAxxxxx... (token do Sistema de Usuário do Meta Business)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Obtenha em:{" "}
                <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer" className="underline text-blue-500">
                  Meta Business → Usuários do Sistema → Gerar token
                </a>
                {" "}com permissões <code>whatsapp_business_management</code>
              </p>
            </div>
          </div>
          {importError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              ✕ {importError}
            </div>
          )}
          {importResult && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700 font-medium">
              ✓ {importResult.imported} template(s) importado(s){importResult.imported === 0 ? " — todos já estavam cadastrados." : " com sucesso!"}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={doImport}
              disabled={importing || !importWabaId.trim() || !importToken.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {importing ? "Importando..." : "Buscar e importar templates"}
            </button>
            <button onClick={() => setShowImport(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(["templates", "create", "profile"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
              activeTab === tab
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {tab === "templates"
              ? `Templates (${templates.length})`
              : tab === "create"
              ? (editingTemplate ? "✏️ Editar Template" : "+ Criar Template")
              : "📷 Foto de Perfil"}
          </button>
        ))}
      </div>

      {/* Aba: Foto de Perfil do WhatsApp Business */}
      {activeTab === "profile" && (
        <div className="max-w-md space-y-4 rounded-xl border border-slate-200 p-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Conexão (número)</label>
            <select
              value={profileConnId}
              onChange={(e) => setProfileConnId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {metaConnections.length === 0
                ? <option value="">Nenhuma conexão Meta configurada</option>
                : metaConnections.map((c) => <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>)
              }
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Imagem (JPG ou PNG)</label>
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => handleProfileFileChange(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </div>

          {profilePreview && (
            <img src={profilePreview} alt="Pré-visualização" className="h-32 w-32 rounded-full object-cover border border-slate-200" />
          )}

          <button
            onClick={uploadProfilePhoto}
            disabled={!profileFile || !profileConn || profileUploading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50"
          >
            {profileUploading ? "Enviando..." : "Salvar foto de perfil"}
          </button>

          {profileMsg && (
            <p className={clsx("text-sm", profileMsg.type === "ok" ? "text-green-600" : "text-red-600")}>
              {profileMsg.text}
            </p>
          )}

          <p className="text-xs text-slate-400">
            A foto é enviada direto para a Meta via API oficial — substitui a foto de perfil atual do WhatsApp Business desse número.
          </p>
        </div>
      )}

      {/* Aba: Lista de Templates */}
      {activeTab === "templates" && (
        <div className="space-y-3">
          {templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
              <div className="text-4xl mb-2">📋</div>
              <p className="font-medium">Nenhum template criado</p>
              <p className="text-sm mt-1">Crie um template e envie para aprovação da Meta.</p>
              <button
                onClick={() => setActiveTab("create")}
                className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
              >
                Criar primeiro template
              </button>
            </div>
          ) : (() => {
            // Agrupa templates por conta (phoneNumberId)
            const groups = new Map<string, WabaTemplate[]>();
            for (const tpl of templates) {
              const key = tpl.phoneNumberId ?? "sem-conta";
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(tpl);
            }
            return [...groups.entries()].map(([phoneId, tpls]) => {
              const conn = metaConnections.find((c) => c.phoneNumberId === phoneId);
              const label = conn ? `${conn.phone} · ${conn.funnelName}` : phoneId === "sem-conta" ? "Sem conta configurada" : `ID: ${phoneId}`;
              return (
                <div key={phoneId} className="space-y-3">
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">🔵 {label}</span>
                    <div className="flex-1 border-t border-slate-100" />
                  </div>
                  {tpls.map((tpl) => (
              <div key={tpl.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-slate-800">{tpl.name}</span>
                      <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_STYLE[tpl.status] ?? STATUS_STYLE.DRAFT)}>
                        {STATUS_LABEL[tpl.status] ?? tpl.status}
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">
                        {tpl.category === "MARKETING" ? "📣 Marketing" : "⚙️ Utilidade"}
                      </span>
                      <span className="text-[10px] text-slate-400">{tpl.language}</span>
                    </div>

                    {/* Conteúdo do template */}
                    {tpl.components.map((c, i) => (
                      <div key={i} className={clsx("text-xs mt-1", c.type === "BODY" ? "text-slate-700" : c.type === "BUTTONS" ? "" : "text-slate-500 italic")}>
                        {c.type === "HEADER" && <><span className="font-semibold">Cabeçalho: </span>{c.text}</>}
                        {c.type === "FOOTER" && <><span>Rodapé: </span>{c.text}</>}
                        {c.type === "BODY" && c.text}
                        {c.type === "BUTTONS" && c.buttons && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.buttons.map((b, bi) => (
                              <span key={bi} className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium border",
                                b.type === "QUICK_REPLY" ? "border-violet-200 bg-violet-50 text-violet-700" :
                                b.type === "URL" ? "border-blue-200 bg-blue-50 text-blue-700" :
                                "border-green-200 bg-green-50 text-green-700"
                              )}>
                                {b.type === "QUICK_REPLY" ? "↩" : b.type === "URL" ? "🔗" : "📞"} {b.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {tpl.rejectedReason && tpl.rejectedReason !== "NONE" && (
                      <div className="mt-1 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                        Motivo: {tpl.rejectedReason}
                      </div>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1 shrink-0">
                    {tpl.status === "DRAFT" && (
                      <button
                        onClick={() => submitToMeta(tpl)}
                        disabled={submitting === tpl.id}
                        className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                      >
                        {submitting === tpl.id ? "..." : "Enviar para Meta"}
                      </button>
                    )}
                    {tpl.status === "APPROVED" && (
                      <button
                        onClick={() => { setSendTemplate(tpl); setSendResult(null); }}
                        className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 transition"
                      >
                        ▶ Disparar
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(tpl)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 transition"
                      title="Editar template"
                    >
                      ✏️
                    </button>
                    {tpl.metaId && (
                      <button
                        onClick={() => syncStatus(tpl.id)}
                        disabled={syncing === tpl.id}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 transition"
                        title="Sincronizar status"
                      >
                        {syncing === tpl.id ? "..." : "↻"}
                      </button>
                    )}
                    <button
                      onClick={() => deleteTemplate(tpl.id)}
                      disabled={deleting === tpl.id}
                      className="text-slate-400 hover:text-red-500 transition text-lg leading-none px-1"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}
                </div>
              );
            });
          })()
          }
        </div>
      )}

      {/* Aba: Criar / Editar Template */}
      {activeTab === "create" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">{editingTemplate ? `Editar: ${editingTemplate.name}` : "Novo Template"}</h2>
            {editingTemplate && (
              <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_STYLE[editingTemplate.status] ?? STATUS_STYLE.DRAFT)}>
                {STATUS_LABEL[editingTemplate.status] ?? editingTemplate.status}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nome do Template <span className="text-slate-400">(snake_case)</span></label>
              <input
                value={form.name}
                onChange={(e) => !editingTemplate && setForm((f) => ({ ...f, name: e.target.value }))}
                readOnly={!!editingTemplate}
                placeholder="ex: oferta_semana, boas_vindas"
                className={clsx("w-full rounded-lg border px-3 py-2 text-sm outline-none", editingTemplate ? "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed" : "border-slate-200 focus:border-violet-400")}
              />
              {editingTemplate && <p className="text-[10px] text-slate-400 mt-0.5">O nome do template não pode ser alterado após criação.</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Categoria</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as "MARKETING" | "UTILITY" }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label} — {c.desc}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cabeçalho (opcional)</label>
            <input
              value={form.headerText}
              onChange={(e) => setForm((f) => ({ ...f, headerText: e.target.value }))}
              placeholder="ex: 🔥 Promoção Especial"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Corpo da Mensagem *</label>
            <textarea
              value={form.bodyText}
              onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
              placeholder="Olá {{1}}, temos uma oferta exclusiva para você..."
              rows={5}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">Use {`{{1}}`}, {`{{2}}`} para variáveis dinâmicas (nome, etc.)</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rodapé (opcional)</label>
            <input
              value={form.footerText}
              onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
              placeholder="ex: Responda PARAR para sair da lista"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>

          {/* Botões */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-600">Botões (opcional)</label>

            {buttons.map((btn, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
                <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 mt-1",
                  btn.type === "QUICK_REPLY" ? "bg-violet-100 text-violet-700" :
                  btn.type === "URL" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                )}>
                  {btn.type === "QUICK_REPLY" ? "↩ Resposta" : btn.type === "URL" ? "🔗 Site" : "📞 Ligar"}
                </span>
                <div className="flex-1 space-y-1.5">
                  <input
                    value={btn.text}
                    onChange={(e) => setButtons((bs) => bs.map((b, j) => j === i ? { ...b, text: e.target.value } : b))}
                    placeholder="Texto do botão (ex: Saiba mais)"
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400"
                  />
                  {btn.type === "URL" && (
                    <input
                      value={btn.url ?? ""}
                      onChange={(e) => setButtons((bs) => bs.map((b, j) => j === i ? { ...b, url: e.target.value } : b))}
                      placeholder="https://seusite.com.br"
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
                    />
                  )}
                  {btn.type === "PHONE_NUMBER" && (
                    <input
                      value={btn.phone ?? ""}
                      onChange={(e) => setButtons((bs) => bs.map((b, j) => j === i ? { ...b, phone: e.target.value } : b))}
                      placeholder="5544999990000"
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-green-400"
                    />
                  )}
                </div>
                <button
                  onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-500 transition text-lg leading-none mt-1 px-1"
                >
                  ×
                </button>
              </div>
            ))}

            {buttons.length < 10 && (
              <div className="flex items-center gap-2">
                <select
                  value={newBtnType}
                  onChange={(e) => setNewBtnType(e.target.value as "QUICK_REPLY"|"URL"|"PHONE_NUMBER")}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-violet-400"
                >
                  <option value="QUICK_REPLY">↩ Personalizado (resposta rápida)</option>
                  <option value="URL">🔗 Acessar o site</option>
                  <option value="PHONE_NUMBER">📞 Ligar</option>
                </select>
                <button
                  onClick={addButton}
                  className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:border-violet-400 hover:text-violet-600 transition"
                >
                  + Adicionar botão
                </button>
              </div>
            )}
            <p className="text-[10px] text-slate-400">Máx: 3 respostas rápidas · 2 links · 1 telefone</p>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold text-slate-600">Configuração Meta (para envio e aprovação)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Conexão WhatsApp</label>
                <select
                  value={form.connId}
                  onChange={(e) => setForm((f) => ({ ...f, connId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
                >
                  {metaConnections.length === 0
                    ? <option value="">Nenhuma conexão Meta configurada</option>
                    : metaConnections.map((c) => (
                      <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>
                    ))
                  }
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">WABA ID</label>
                <input
                  value={form.wabaId}
                  onChange={(e) => setForm((f) => ({ ...f, wabaId: e.target.value }))}
                  placeholder="Ex: 123456789012345"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">Gerenciador Meta → WhatsApp → ID da conta</p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.submitNow}
                onChange={(e) => setForm((f) => ({ ...f, submitNow: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-slate-700">Enviar para aprovação da Meta imediatamente</span>
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={createTemplate}
              disabled={creating || (!editingTemplate && !form.name.trim()) || !form.bodyText.trim()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition"
            >
              {creating
                ? (editingTemplate ? "Salvando..." : "Criando...")
                : editingTemplate
                  ? (form.submitNow ? "Salvar e Reenviar para Meta" : "Salvar Alterações")
                  : (form.submitNow ? "Criar e Enviar para Meta" : "Criar Rascunho")}
            </button>
            <button
              onClick={() => { setActiveTab("templates"); resetForm(); }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal de envio */}
      {sendTemplate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Disparar: <span className="font-mono text-violet-700">{sendTemplate.name}</span></h3>
              <button onClick={() => { setSendTemplate(null); setSendResult(null); setVarValues({}); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="space-y-3">
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input type="radio" checked={sendTarget === "phone"} onChange={() => setSendTarget("phone")} />
                  Número específico
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input type="radio" checked={sendTarget === "all"} onChange={() => setSendTarget("all")} />
                  Todos do funil
                </label>
              </div>

              {sendTarget === "phone" ? (
                <input
                  value={sendPhone}
                  onChange={(e) => setSendPhone(e.target.value)}
                  placeholder="5511999991234"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
                />
              ) : (
                <select
                  value={sendFunnelId}
                  onChange={(e) => setSendFunnelId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
                >
                  {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
            </div>

            {/* Campos para variáveis {{n}} do template */}
            {sendTemplate.components.some((c) => c.text && /\{\{\d+\}\}/.test(c.text)) && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Preencha as variáveis do template</p>
                {sendTemplate.components.filter((c) => c.text && /\{\{\d+\}\}/.test(c.text)).map((comp) => {
                  const matches = [...comp.text!.matchAll(/\{\{(\d+)\}\}/g)];
                  return (
                    <div key={comp.type} className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">
                        {comp.type === "HEADER" ? "Cabeçalho" : "Corpo"}
                      </p>
                      {matches.map((m, i) => (
                        <div key={m[1]} className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 shrink-0">{`{{${m[1]}}}`}</span>
                          <input
                            value={varValues[comp.type]?.[i] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setVarValues((prev) => {
                                const arr = [...(prev[comp.type] ?? [])];
                                arr[i] = val;
                                return { ...prev, [comp.type]: arr };
                              });
                            }}
                            placeholder="Digite o valor..."
                            className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 bg-white"
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {sendResult && (
              <div className={clsx("rounded-lg p-3 text-sm font-medium space-y-1", sendResult.sent === sendResult.total && sendResult.total > 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
                <p>{sendResult.sent === sendResult.total && sendResult.total > 0 ? "✓" : "✗"} {sendResult.sent}/{sendResult.total} mensagens enviadas com sucesso</p>
                {sendResult.results?.filter((r) => !r.success).map((r) => {
                  let errMsg = r.error ?? "erro desconhecido";
                  try { errMsg = JSON.parse(errMsg)?.error?.message ?? errMsg; } catch { /* keep raw */ }
                  return (
                    <p key={r.phone} className="text-xs opacity-80 font-normal">
                      {r.phone}: {errMsg}
                    </p>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={doSend}
                disabled={sending || (sendTarget === "phone" && !sendPhone)}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition"
              >
                {sending ? "Enviando..." : "Disparar Agora"}
              </button>
              <button
                onClick={() => { setSendTemplate(null); setSendResult(null); setVarValues({}); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
