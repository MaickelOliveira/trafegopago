"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { CrmAutomation, CrmTrigger, CrmStep, CrmStepType } from "@/lib/crm-automations";
import type { Funnel } from "@/lib/funnels";
import type { WabaTemplate } from "@/lib/waba-templates";

// ── Props ─────────────────────────────────────────────────────────────────────
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

// ── Step form state ────────────────────────────────────────────────────────────
type StepForm = {
  id: string;
  type: CrmStepType;
  connectionId: string;
  message: string;
  templateId: string;
  templateVariables: Record<string, string[]>;
  listTitle: string;
  listButtonText: string;
  listRows: { id: string; title: string; description: string }[];
  note: string;
  targetFunnelId: string;
  targetColumnId: string;
  delayMinutes: number;
  webhookUrl: string;
  webhookBody: string;
};

type FormState = {
  name: string;
  trigger: CrmTrigger;
  funnelId: string;
  triggerColumnId: string;
  scheduledTime: string;
  steps: StepForm[];
};

// ── Constants ─────────────────────────────────────────────────────────────────
const TRIGGER_LABEL: Record<CrmTrigger, string> = {
  lead_created:    "🎯 Lead cadastrado (via formulário)",
  column_changed:  "↕ Lead muda para qualquer coluna",
  column_entered:  "🔀 Lead chega/é criado em uma coluna",
  scheduled_daily: "📅 Diariamente às…",
};

const STEP_ICONS: Record<CrmStepType, string> = {
  send_message:  "💬",
  send_template: "🟢",
  send_list:     "📋",
  add_note:      "📝",
  move_column:   "➡️",
  delay:         "⏸",
  webhook:       "🔗",
};

const STEP_LABELS: Record<CrmStepType, string> = {
  send_message:  "Enviar mensagem (WhatsApp)",
  send_template: "Enviar template Meta (WABA)",
  send_list:     "Enviar lista interativa (WhatsApp)",
  add_note:      "Adicionar nota ao lead",
  move_column:   "Mover lead de coluna",
  delay:         "Pausar",
  webhook:       "Chamar webhook externo",
};

const DELAY_OPTIONS = [
  { value: 1,    label: "1 minuto" },
  { value: 5,    label: "5 minutos" },
  { value: 10,   label: "10 minutos" },
  { value: 30,   label: "30 minutos" },
  { value: 60,   label: "1 hora" },
  { value: 120,  label: "2 horas" },
  { value: 360,  label: "6 horas" },
  { value: 1440, label: "24 horas" },
];

const STEP_TYPES_ORDERED: CrmStepType[] = [
  "send_message", "send_template", "send_list",
  "add_note", "move_column", "delay", "webhook",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function blankStep(type: CrmStepType, connId = "", tplId = ""): StepForm {
  return {
    id: uid(), type,
    connectionId: connId, message: "Olá {{nome}}! ",
    templateId: tplId, templateVariables: {},
    listTitle: "Selecione uma opção", listButtonText: "Ver opções",
    listRows: [{ id: "1", title: "Opção 1", description: "" }],
    note: "", targetFunnelId: "", targetColumnId: "",
    delayMinutes: 5,
    webhookUrl: "", webhookBody: "",
  };
}

function stepsFromAuto(auto: CrmAutomation, connId: string, tplId: string): StepForm[] {
  if (auto.steps && auto.steps.length > 0) {
    return auto.steps.map((s: CrmStep) => ({
      id: uid(), type: s.type,
      connectionId: s.connectionId ?? connId,
      message: s.message ?? "",
      templateId: s.templateId ?? tplId,
      templateVariables: s.templateVariables ?? {},
      listTitle: s.listTitle ?? "Selecione uma opção",
      listButtonText: s.listButtonText ?? "Ver opções",
      listRows: (s.listRows ?? []).map((r) => ({ ...r, description: r.description ?? "" })),
      note: s.note ?? "",
      targetFunnelId: s.targetFunnelId ?? "",
      targetColumnId: s.targetColumnId ?? "",
      delayMinutes: s.delayMinutes ?? 5,
      webhookUrl: s.webhookUrl ?? "",
      webhookBody: s.webhookBody ?? "",
    }));
  }
  // Legacy: reconstruct
  const steps: StepForm[] = [];
  if ((auto.delayMinutes ?? 0) > 0) {
    const d = blankStep("delay", connId, tplId);
    d.delayMinutes = auto.delayMinutes ?? 5;
    steps.push(d);
  }
  const main = blankStep(auto.channel === "waba" ? "send_template" : "send_message", connId, tplId);
  main.connectionId = auto.connectionId ?? connId;
  main.message = auto.message ?? "";
  main.templateId = auto.templateId ?? tplId;
  main.templateVariables = auto.templateVariables ?? {};
  steps.push(main);
  return steps;
}

function stepsToPayload(steps: StepForm[]): CrmStep[] {
  return steps.map((s) => {
    const base: CrmStep = { id: s.id, type: s.type };
    if (s.type === "send_message") {
      base.connectionId = s.connectionId; base.message = s.message;
    } else if (s.type === "send_template") {
      base.connectionId = s.connectionId; base.templateId = s.templateId;
      if (Object.keys(s.templateVariables).length > 0) base.templateVariables = s.templateVariables;
    } else if (s.type === "send_list") {
      base.connectionId = s.connectionId;
      base.listTitle = s.listTitle; base.listButtonText = s.listButtonText;
      base.listRows = s.listRows;
    } else if (s.type === "add_note") {
      base.note = s.note;
    } else if (s.type === "move_column") {
      base.targetFunnelId = s.targetFunnelId || undefined;
      base.targetColumnId = s.targetColumnId;
    } else if (s.type === "delay") {
      base.delayMinutes = s.delayMinutes;
    } else if (s.type === "webhook") {
      base.webhookUrl = s.webhookUrl; base.webhookBody = s.webhookBody || undefined;
    }
    return base;
  });
}

// ── Step editor ───────────────────────────────────────────────────────────────
function StepEditor({
  step, onChange, funnels, connections, approvedTemplates,
}: {
  step: StepForm;
  onChange: (patch: Partial<StepForm>) => void;
  funnels: Funnel[];
  connections: ConnectionInfo[];
  approvedTemplates: WabaTemplate[];
}) {
  const uazapiConns = connections.filter((c) => c.type === "uazapi");
  const metaConns   = connections.filter((c) => c.type === "meta");
  const sel = (field: keyof StepForm, val: unknown) => onChange({ [field]: val } as Partial<StepForm>);

  if (step.type === "send_message") {
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Conexão UazapiGO</label>
          <select value={step.connectionId} onChange={(e) => sel("connectionId", e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
            {uazapiConns.length === 0
              ? <option value="">Nenhuma conexão UazapiGO configurada</option>
              : uazapiConns.map((c) => <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Mensagem</label>
          <textarea value={step.message} onChange={(e) => sel("message", e.target.value)} rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white resize-none" />
          <p className="text-[10px] text-slate-400 mt-1">Variáveis: <code>{"{{nome}}"}</code> <code>{"{{telefone}}"}</code> <code>{"{{email}}"}</code> <code>{"{{funil}}"}</code></p>
        </div>
      </div>
    );
  }

  if (step.type === "send_template") {
    const tpl = approvedTemplates.find((t) => t.id === step.templateId);
    const varComps = tpl?.components.filter((c) => c.text && /\{\{\d+\}\}/.test(c.text)) ?? [];
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Conexão Meta</label>
          <select value={step.connectionId} onChange={(e) => sel("connectionId", e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
            {metaConns.length === 0
              ? <option value="">Nenhuma conexão Meta configurada</option>
              : metaConns.map((c) => <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Template aprovado</label>
          {approvedTemplates.length === 0
            ? <p className="text-sm text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">Nenhum template aprovado. Importe em Disparos WA.</p>
            : <select value={step.templateId}
                onChange={(e) => { sel("templateId", e.target.value); sel("templateVariables", {}); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
                {approvedTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>}
        </div>
        {tpl && (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="bg-[#e9f5fe] px-3 py-3 space-y-1 border-b border-slate-200">
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Preview</p>
              {tpl.components.filter((c) => c.type !== "BUTTONS" && c.text).map((c) => (
                <p key={c.type} className={clsx("text-sm text-slate-800 whitespace-pre-wrap",
                  c.type === "HEADER" && "font-bold", c.type === "FOOTER" && "text-slate-400 text-[11px]")}>
                  {c.text!.split(/(\{\{\d+\}\})/).map((part, i) =>
                    /\{\{\d+\}\}/.test(part)
                      ? <span key={i} className="bg-blue-100 text-blue-700 rounded px-0.5 font-mono">{part}</span>
                      : part)}
                </p>
              ))}
            </div>
            {varComps.length > 0 && (
              <div className="px-3 py-3 space-y-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Variáveis do template</p>
                {varComps.map((comp) => {
                  const matches = [...comp.text!.matchAll(/\{\{(\d+)\}\}/g)];
                  return (
                    <div key={comp.type}>
                      <p className="text-[10px] font-semibold text-slate-500 mb-1">{comp.type === "HEADER" ? "🔝 Header" : "📝 Body"}</p>
                      <div className="space-y-1.5">
                        {matches.map((m) => {
                          const idx = parseInt(m[1]) - 1;
                          const current = step.templateVariables[comp.type]?.[idx] ?? "";
                          return (
                            <div key={m[1]} className="flex items-center gap-2">
                              <span className="text-xs font-mono bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 shrink-0">{`{{${m[1]}}}`}</span>
                              <div className="flex-1 relative">
                                <input value={current}
                                  onChange={(e) => {
                                    const vars = { ...step.templateVariables };
                                    const arr = [...(vars[comp.type] ?? [])];
                                    arr[idx] = e.target.value;
                                    vars[comp.type] = arr;
                                    sel("templateVariables", vars);
                                  }}
                                  placeholder={`Valor para {{${m[1]}}}`}
                                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white pr-24" />
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                                  {["{{nome}}", "{{telefone}}", "{{email}}"].map((v) => (
                                    <button key={v} type="button"
                                      onClick={() => {
                                        const vars = { ...step.templateVariables };
                                        const arr = [...(vars[comp.type] ?? [])];
                                        arr[idx] = v;
                                        vars[comp.type] = arr;
                                        sel("templateVariables", vars);
                                      }}
                                      className="rounded bg-slate-100 hover:bg-violet-100 hover:text-violet-700 px-1 py-0.5 text-[9px] font-mono text-slate-500 transition">
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
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (step.type === "send_list") {
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Conexão UazapiGO</label>
          <select value={step.connectionId} onChange={(e) => sel("connectionId", e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
            {uazapiConns.map((c) => <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Título da lista</label>
            <input value={step.listTitle} onChange={(e) => sel("listTitle", e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Texto do botão</label>
            <input value={step.listButtonText} onChange={(e) => sel("listButtonText", e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Opções da lista</label>
          <div className="space-y-2">
            {step.listRows.map((row, i) => (
              <div key={row.id} className="flex gap-2 items-center">
                <input value={row.title} onChange={(e) => {
                  const rows = [...step.listRows]; rows[i] = { ...rows[i], title: e.target.value }; sel("listRows", rows);
                }} placeholder="Título" className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                <input value={row.description} onChange={(e) => {
                  const rows = [...step.listRows]; rows[i] = { ...rows[i], description: e.target.value }; sel("listRows", rows);
                }} placeholder="Descrição (opcional)" className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                <button onClick={() => sel("listRows", step.listRows.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-500 px-1 text-lg">×</button>
              </div>
            ))}
          </div>
          <button onClick={() => sel("listRows", [...step.listRows, { id: String(step.listRows.length + 1), title: "", description: "" }])}
            className="mt-2 text-xs text-violet-600 hover:text-violet-700 font-medium">+ Adicionar opção</button>
        </div>
      </div>
    );
  }

  if (step.type === "add_note") {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Nota (adicionada ao lead)</label>
        <textarea value={step.note} onChange={(e) => sel("note", e.target.value)} rows={3}
          placeholder="Ex: Lead entrou na etapa de proposta. Acompanhar em 48h."
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white resize-none" />
        <p className="text-[10px] text-slate-400 mt-1">Variáveis: <code>{"{{nome}}"}</code> <code>{"{{telefone}}"}</code> <code>{"{{funil}}"}</code></p>
      </div>
    );
  }

  if (step.type === "move_column") {
    const targetFunnel = funnels.find((f) => f.id === step.targetFunnelId);
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Funil de destino</label>
          <select value={step.targetFunnelId}
            onChange={(e) => { sel("targetFunnelId", e.target.value); sel("targetColumnId", ""); }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
            <option value="">Mesmo funil do lead</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Coluna de destino <span className="text-red-500">*</span></label>
          {!step.targetFunnelId
            ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-slate-50">← Selecione um funil</div>
            : <select value={step.targetColumnId} onChange={(e) => sel("targetColumnId", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
                <option value="">— Selecione —</option>
                {(targetFunnel?.columns ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>}
        </div>
      </div>
    );
  }

  if (step.type === "delay") {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Aguardar antes do próximo passo</label>
        <select value={step.delayMinutes} onChange={(e) => sel("delayMinutes", Number(e.target.value))}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
          {DELAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  if (step.type === "webhook") {
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">URL (HTTP POST)</label>
          <input value={step.webhookUrl} onChange={(e) => sel("webhookUrl", e.target.value)}
            placeholder="https://seu-webhook.com/endpoint"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Body JSON (opcional)</label>
          <textarea value={step.webhookBody} onChange={(e) => sel("webhookBody", e.target.value)} rows={3}
            placeholder={`{"nome": "{{nome}}", "telefone": "{{telefone}}", "funil": "{{funil}}"}`}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-violet-400 bg-white resize-none" />
          <p className="text-[10px] text-slate-400 mt-1">Deixe vazio para enviar os dados do lead automaticamente. Suporta variáveis <code>{"{{nome}}"}</code> etc.</p>
        </div>
      </div>
    );
  }

  return null;
}

// ── Step summary ──────────────────────────────────────────────────────────────
function stepSummary(step: StepForm, conns: ConnectionInfo[], templates: WabaTemplate[]) {
  switch (step.type) {
    case "send_message": {
      const c = conns.find((x) => x.id === step.connectionId);
      return `${c?.phone ?? "sem conexão"} · "${step.message.slice(0, 35)}${step.message.length > 35 ? "…" : ""}"`;
    }
    case "send_template": {
      const t = templates.find((x) => x.id === step.templateId);
      return t ? `Template: ${t.name}` : "Nenhum template";
    }
    case "send_list": return `"${step.listTitle}" · ${step.listRows.length} opções`;
    case "add_note": return `"${step.note.slice(0, 40)}${step.note.length > 40 ? "…" : ""}"`;
    case "move_column": return step.targetColumnId ? `→ col. ${step.targetColumnId}` : "Coluna não configurada";
    case "delay": return DELAY_OPTIONS.find((o) => o.value === step.delayMinutes)?.label ?? `${step.delayMinutes}min`;
    case "webhook": return step.webhookUrl ? step.webhookUrl.replace(/^https?:\/\//, "").slice(0, 40) : "URL não configurada";
    default: return "";
  }
}

// ── AutoCard ──────────────────────────────────────────────────────────────────
function AutoCard({
  auto, isEditing, toggling, deleting, funnels,
  onEdit, onToggle, onDelete,
}: {
  auto: CrmAutomation; isEditing: boolean; toggling: boolean; deleting: boolean;
  funnels: Funnel[];
  onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const funnel = funnels.find((f) => f.id === auto.funnelId);
  const col = funnel?.columns.find((c) => c.id === auto.triggerColumnId);
  const steps = auto.steps ?? [];

  return (
    <div className={clsx(
      "rounded-xl border p-4 transition",
      isEditing ? "border-violet-300 bg-violet-50" :
      auto.active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-slate-800 text-sm">{auto.name}</span>
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold",
              auto.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
              {auto.active ? "Ativa" : "Pausada"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-2">
            <span className="font-medium">{TRIGGER_LABEL[auto.trigger] ?? auto.trigger}</span>
            {funnel && <> · {funnel.name}</>}
            {col && <> · <span className="font-medium">{col.label}</span></>}
            {auto.trigger === "scheduled_daily" && auto.scheduledTime && <> às <strong>{auto.scheduledTime}</strong></>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {steps.length > 0 ? steps.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                {STEP_ICONS[s.type]} {STEP_LABELS[s.type]}
              </span>
            )) : (
              <span className="text-xs text-slate-400 italic">Automação legada (sem passos)</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit}
            className={clsx("rounded-lg px-2.5 py-1 text-xs font-semibold transition",
              isEditing ? "bg-violet-100 text-violet-700 hover:bg-violet-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            {isEditing ? "✕ Fechar" : "✏ Editar"}
          </button>
          <button onClick={onToggle} disabled={toggling}
            className={clsx("rounded-lg px-2.5 py-1 text-xs font-semibold transition",
              auto.active ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-green-100 text-green-700 hover:bg-green-200")}>
            {toggling ? "..." : auto.active ? "Pausar" : "Ativar"}
          </button>
          <button onClick={onDelete} disabled={deleting}
            className="text-slate-400 hover:text-red-500 transition text-lg leading-none px-1" title="Excluir">
            {deleting ? "..." : "×"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CrmAutomationsView({
  clientId, initialAutomations, funnels, connections, approvedTemplates,
}: Props) {
  const [automations, setAutomations] = useState<CrmAutomation[]>(initialAutomations);
  const [showForm, setShowForm]         = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [toggling, setToggling]         = useState<string | null>(null);
  const [deleting, setDeleting]         = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [showPicker, setShowPicker]     = useState(false);

  const uazapiConnId = connections.find((c) => c.type === "uazapi")?.id ?? "";
  const metaConnId   = connections.find((c) => c.type === "meta")?.id ?? "";
  const firstTplId   = approvedTemplates[0]?.id ?? "";

  const blankFormFn = (): FormState => ({
    name: "", trigger: "lead_created", funnelId: "", triggerColumnId: "", scheduledTime: "09:00",
    steps: [blankStep("send_message", uazapiConnId, firstTplId)],
  });

  const [form, setForm] = useState<FormState>(blankFormFn());
  const selectedFunnel = funnels.find((f) => f.id === form.funnelId);

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function openNew() {
    setForm(blankFormFn()); setExpandedStep(null); setShowPicker(false);
    setEditingId(null); setShowForm(true);
    setTimeout(() => document.getElementById("crm-form")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function openEdit(auto: CrmAutomation) {
    setForm({
      name: auto.name, trigger: auto.trigger,
      funnelId: auto.funnelId ?? "", triggerColumnId: auto.triggerColumnId ?? "",
      scheduledTime: auto.scheduledTime ?? "09:00",
      steps: stepsFromAuto(auto, uazapiConnId, firstTplId),
    });
    setExpandedStep(null); setShowPicker(false); setEditingId(auto.id); setShowForm(true);
    setTimeout(() => document.getElementById("crm-form")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function closeForm() {
    setShowForm(false); setEditingId(null); setExpandedStep(null); setShowPicker(false);
  }

  function addStep(type: CrmStepType) {
    const connId = type === "send_template" ? metaConnId : uazapiConnId;
    const s = blankStep(type, connId, firstTplId);
    const steps = [...form.steps, s];
    setField("steps", steps); setExpandedStep(s.id); setShowPicker(false);
  }

  function updateStep(id: string, patch: Partial<StepForm>) {
    setField("steps", form.steps.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  function removeStep(id: string) {
    setField("steps", form.steps.filter((s) => s.id !== id));
    if (expandedStep === id) setExpandedStep(null);
  }

  function moveStep(id: string, dir: -1 | 1) {
    const idx = form.steps.findIndex((s) => s.id === id);
    if (idx + dir < 0 || idx + dir >= form.steps.length) return;
    const steps = [...form.steps];
    [steps[idx], steps[idx + dir]] = [steps[idx + dir], steps[idx]];
    setField("steps", steps);
  }

  async function save() {
    if (!form.name.trim() || form.steps.length === 0) return;
    setSaving(true);
    const triggerNeedsCol = form.trigger !== "lead_created";
    const payload = {
      clientId, name: form.name.trim(), trigger: form.trigger,
      funnelId: form.funnelId || undefined,
      triggerColumnId: triggerNeedsCol ? form.triggerColumnId || undefined : undefined,
      scheduledTime: form.trigger === "scheduled_daily" ? form.scheduledTime : undefined,
      steps: stepsToPayload(form.steps),
      active: true,
    };
    if (editingId) {
      const res = await fetch(`/api/crm/automations/${editingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json() as CrmAutomation;
        setAutomations((prev) => prev.map((a) => a.id === editingId ? updated : a));
        closeForm();
      }
    } else {
      const res = await fetch("/api/crm/automations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
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
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !auto.active }),
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

  const triggerNeedsColumn = form.trigger !== "lead_created";
  const triggerNeedsFunnel = form.trigger === "column_entered" || form.trigger === "scheduled_daily";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Automações CRM</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Fluxos multi-passo disparados por gatilhos do funil — mensagens, notas, mover coluna, webhooks e mais.
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition">
          + Nova Automação
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div id="crm-form" className="rounded-xl border border-violet-200 bg-violet-50 p-5 space-y-5">
          <h2 className="font-semibold text-slate-800">{editingId ? "✏ Editar automação" : "Configurar nova automação"}</h2>

          {/* Nome */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nome da automação</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)}
              placeholder="ex: Boas-vindas, Follow-up Proposta, Alerta diário"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white" />
          </div>

          {/* Gatilho */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Gatilho</label>
              <select value={form.trigger}
                onChange={(e) => { setField("trigger", e.target.value as CrmTrigger); setField("triggerColumnId", ""); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
                {(Object.keys(TRIGGER_LABEL) as CrmTrigger[]).map((t) => (
                  <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Funil {triggerNeedsFunnel ? <span className="text-red-500">*</span> : "(opcional)"}
              </label>
              <select value={form.funnelId}
                onChange={(e) => { setField("funnelId", e.target.value); setField("triggerColumnId", ""); }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
                {triggerNeedsFunnel
                  ? <option value="">— Selecione um funil —</option>
                  : <option value="">Qualquer funil</option>}
                {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>

          {/* Coluna alvo */}
          {triggerNeedsColumn && (
            <div className={clsx("grid gap-3", form.trigger === "scheduled_daily" ? "grid-cols-2" : "grid-cols-1")}>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {form.trigger === "scheduled_daily" ? "Coluna dos leads (alvo)" : "Coluna de destino"}
                  {form.funnelId && <span className="text-red-500 ml-1">*</span>}
                </label>
                {!form.funnelId
                  ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-slate-50 cursor-not-allowed">← Selecione um funil primeiro</div>
                  : <select value={form.triggerColumnId} onChange={(e) => setField("triggerColumnId", e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
                      <option value="">— Qualquer coluna —</option>
                      {(selectedFunnel?.columns ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>}
              </div>
              {form.trigger === "scheduled_daily" && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Horário de disparo <span className="text-red-500">*</span></label>
                  <input type="time" value={form.scheduledTime} onChange={(e) => setField("scheduledTime", e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white" />
                  <p className="text-[10px] text-slate-400 mt-1">Chamar <code className="bg-slate-100 px-1 rounded">/api/cron/daily</code> neste horário via EasyPanel ou n8n.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Passos ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Passos da automação</label>
              <span className="text-xs text-slate-400">{form.steps.length} {form.steps.length === 1 ? "passo" : "passos"}</span>
            </div>

            {form.steps.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                Nenhum passo configurado. Clique em "Adicionar passo" abaixo.
              </div>
            )}

            <div className="space-y-2">
              {form.steps.map((step, idx) => (
                <div key={step.id} className={clsx(
                  "rounded-lg border bg-white",
                  expandedStep === step.id ? "border-violet-300" : "border-slate-200",
                )}>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span className="text-base shrink-0">{STEP_ICONS[step.type]}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-slate-700">{STEP_LABELS[step.type]}</span>
                      <span className="text-xs text-slate-400 ml-2 truncate">{stepSummary(step, connections, approvedTemplates)}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => moveStep(step.id, -1)} disabled={idx === 0}
                        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs">▲</button>
                      <button onClick={() => moveStep(step.id, 1)} disabled={idx === form.steps.length - 1}
                        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs">▼</button>
                      <button onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 transition">
                        {expandedStep === step.id ? "Fechar" : "Editar"}
                      </button>
                      <button onClick={() => removeStep(step.id)}
                        className="text-slate-400 hover:text-red-500 transition text-lg leading-none px-1">×</button>
                    </div>
                  </div>
                  {expandedStep === step.id && (
                    <div className="px-3 pb-3 border-t border-slate-100 pt-3">
                      <StepEditor step={step} onChange={(patch) => updateStep(step.id, patch)}
                        funnels={funnels} connections={connections} approvedTemplates={approvedTemplates} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Step picker */}
            <div className="mt-2 relative">
              <button onClick={() => setShowPicker((v) => !v)}
                className="w-full rounded-lg border border-dashed border-violet-300 px-3 py-2 text-sm text-violet-600 hover:bg-violet-50 transition font-medium">
                + Adicionar passo
              </button>
              {showPicker && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-2 grid grid-cols-2 gap-1 w-full">
                  {STEP_TYPES_ORDERED.map((type) => (
                    <button key={type} onClick={() => addStep(type)}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition text-left">
                      <span className="text-base">{STEP_ICONS[type]}</span>
                      <span>{STEP_LABELS[type]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Save/Cancel */}
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving || !form.name.trim() || form.steps.length === 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition">
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar Automação"}
            </button>
            <button onClick={closeForm}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {automations.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
          <div className="text-4xl mb-2">⚡</div>
          <p className="font-medium">Nenhuma automação criada</p>
          <p className="text-sm mt-1">Configure fluxos automáticos com múltiplos passos.</p>
          <button onClick={openNew} className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
            Criar primeira automação
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((auto) => (
            <AutoCard key={auto.id} auto={auto}
              isEditing={editingId === auto.id}
              toggling={toggling === auto.id} deleting={deleting === auto.id}
              funnels={funnels}
              onEdit={() => editingId === auto.id ? closeForm() : openEdit(auto)}
              onToggle={() => toggleActive(auto)}
              onDelete={() => remove(auto.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
