"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { CrmAutomation, CrmTrigger, CrmStep, CrmStepType } from "@/lib/crm-automations";
import type { Funnel } from "@/lib/funnels";
import type { WabaTemplate } from "@/lib/waba-templates";
import type { WebhookConfig } from "@/lib/webhooks";

// ── Props ─────────────────────────────────────────────────────────────────────
type ConnectionInfo = {
  id: string;
  type: "uazapi" | "meta" | "wppconnect";
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
  webhooks: WebhookConfig[];
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
  imageUrl: string;
};

type FormState = {
  name: string;
  trigger: CrmTrigger;
  funnelId: string;
  triggerColumnId: string;
  triggerWebhookId: string;
  scheduledTime: string;
  triggerKeywords: string[];
  steps: StepForm[];
};

// ── Constants ─────────────────────────────────────────────────────────────────
const TRIGGER_OPTIONS: { value: CrmTrigger; icon: string; label: string; description: string }[] = [
  {
    value: "lead_created",
    icon: "🎯",
    label: "Lead cadastrado",
    description: "Dispara quando alguém preenche o formulário do site",
  },
  {
    value: "column_entered",
    icon: "🔀",
    label: "Lead chega em etapa específica",
    description: "Você escolhe a etapa. Ex: lead chegou em 'Proposta' → envia mensagem de orçamento",
  },
  {
    value: "column_changed",
    icon: "↕",
    label: "Lead muda de qualquer etapa",
    description: "Dispara em toda e qualquer mudança de etapa, sem filtrar qual. Use para registros gerais",
  },
  {
    value: "scheduled_daily",
    icon: "📅",
    label: "Todo dia num horário",
    description: "Dispara diariamente para todos os leads de uma etapa",
  },
  {
    value: "message_received",
    icon: "💬",
    label: "Lead envia frase específica",
    description: "Dispara quando o lead manda uma mensagem com determinada palavra ou frase",
  },
];

const TRIGGER_LABEL: Record<CrmTrigger, string> = {
  lead_created:    "🎯 Lead cadastrado",
  column_changed:  "↕ Lead muda de etapa",
  column_entered:  "🔀 Lead chega numa etapa",
  scheduled_daily: "📅 Diariamente",
  message_received: "💬 Frase específica",
};

// Simplified step picker options (hidden technical split between send_message / send_template)
const STEP_PICKER_OPTIONS = [
  {
    type: "send_message" as CrmStepType,
    icon: "💬",
    label: "Enviar mensagem",
    description: "WhatsApp via UazapiGO (texto livre) ou template oficial Meta",
  },
  {
    type: "send_list" as CrmStepType,
    icon: "📱",
    label: "Menu com opções",
    description: "Botões interativos para o lead escolher uma opção",
  },
  {
    type: "add_note" as CrmStepType,
    icon: "📝",
    label: "Anotar no lead",
    description: "Adiciona uma observação automática no cadastro do lead",
  },
  {
    type: "move_column" as CrmStepType,
    icon: "➡️",
    label: "Mover de etapa",
    description: "Move o lead para outra etapa ou funil",
  },
  {
    type: "delay" as CrmStepType,
    icon: "⏸",
    label: "Aguardar um tempo",
    description: "Espera antes de executar o próximo passo",
  },
  {
    type: "webhook" as CrmStepType,
    icon: "🔗",
    label: "Conectar a outro sistema",
    description: "Envia os dados do lead para um sistema externo via webhook",
  },
];

const STEP_ICONS: Record<CrmStepType, string> = {
  send_message:  "💬",
  send_template: "💬", // same as send_message (unified UX)
  send_list:     "📱",
  add_note:      "📝",
  move_column:   "➡️",
  delay:         "⏸",
  webhook:       "🔗",
};

const STEP_LABELS: Record<CrmStepType, string> = {
  send_message:  "Enviar mensagem",
  send_template: "Enviar mensagem",
  send_list:     "Menu com opções",
  add_note:      "Anotar no lead",
  move_column:   "Mover de etapa",
  delay:         "Aguardar",
  webhook:       "Conectar sistema",
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

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
};
const CATEGORY_COLOR: Record<string, string> = {
  MARKETING: "bg-orange-100 text-orange-700",
  UTILITY: "bg-blue-100 text-blue-700",
};

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
    imageUrl: "",
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
      imageUrl: s.imageUrl ?? "",
    }));
  }
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
      if (s.imageUrl) base.imageUrl = s.imageUrl;
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

// ── Input / Select helpers ────────────────────────────────────────────────────
const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white";
const labelCls = "block text-xs font-semibold text-slate-500 mb-1";

// ── Step editor (unified send_message + send_template) ─────────────────────────
function StepEditor({
  step, onChange, funnels, connections, approvedTemplates,
}: {
  step: StepForm;
  onChange: (patch: Partial<StepForm>) => void;
  funnels: Funnel[];
  connections: ConnectionInfo[];
  approvedTemplates: WabaTemplate[];
}) {
  const sel = (field: keyof StepForm, val: unknown) => onChange({ [field]: val } as Partial<StepForm>);
  const uazapiConns    = connections.filter((c) => c.type === "uazapi");
  const metaConns      = connections.filter((c) => c.type === "meta");
  const wppConns       = connections.filter((c) => c.type === "wppconnect");
  const allConns       = [...uazapiConns, ...wppConns, ...metaConns];

  // ── Unified send message (UazapiGO text OR Meta template) ─────────────────
  if (step.type === "send_message" || step.type === "send_template") {
    const selectedConn = connections.find((c) => c.id === step.connectionId);
    const isMeta = selectedConn?.type === "meta" || step.type === "send_template";

    // Group templates by category
    const byCategory = approvedTemplates.reduce<Record<string, WabaTemplate[]>>((acc, t) => {
      (acc[t.category] = acc[t.category] ?? []).push(t);
      return acc;
    }, {});

    const tpl = approvedTemplates.find((t) => t.id === step.templateId);
    const varComps = tpl?.components.filter((c) => c.text && /\{\{\d+\}\}/.test(c.text)) ?? [];

    return (
      <div className="space-y-4">
        {/* Channel selector */}
        <div>
          <label className={labelCls}>Por qual número enviar?</label>
          {allConns.length === 0 ? (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-700">
              Nenhum número conectado. Configure em Configurações → Funil.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {allConns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    if (c.type === "meta") {
                      onChange({ connectionId: c.id, type: "send_template" });
                    } else {
                      onChange({ connectionId: c.id, type: "send_message" });
                    }
                    // wppconnect falls into the else branch → send_message
                  }}
                  className={clsx(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition",
                    step.connectionId === c.id
                      ? "border-violet-400 bg-violet-50 text-violet-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/50",
                  )}
                >
                  <span className="text-base">{c.type === "meta" ? "🟢" : "📱"}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">{c.phone}</span>
                    <span className="text-slate-400 ml-2 text-xs">({c.funnelName})</span>
                  </div>
                  <span className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0",
                    c.type === "uazapi" ? "bg-emerald-100 text-emerald-700"
                    : c.type === "wppconnect" ? "bg-blue-100 text-blue-700"
                    : "bg-green-100 text-green-700",
                  )}>
                    {c.type === "uazapi" ? "UazapiGO" : c.type === "wppconnect" ? "WPPConnect" : "API Meta"}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-1">
            📱 UazapiGO / WPPConnect = texto livre &nbsp;·&nbsp; 🟢 API Meta = templates aprovados
          </p>
        </div>

        {/* UazapiGO: free text */}
        {!isMeta && step.connectionId && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Mensagem</label>
              <textarea
                value={step.message}
                onChange={(e) => sel("message", e.target.value)}
                rows={4}
                placeholder="Olá {{nome}}, tudo bem?"
                className={clsx(inputCls, "resize-none")}
              />
              <p className="text-[10px] text-slate-400 mt-1">
                <span className="font-semibold text-violet-600">{`{{nome}}`}</span> = primeiro nome &nbsp;·&nbsp;
                <span className="font-semibold text-violet-600">{`{{nome_completo}}`}</span> = nome completo
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {["{{nome}}", "{{nome_completo}}", "{{telefone}}", "{{email}}", "{{funil}}"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => sel("message", (step.message ?? "") + v)}
                    className="rounded bg-slate-100 hover:bg-violet-100 hover:text-violet-700 px-2 py-0.5 text-[10px] font-mono text-slate-600 transition"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Imagem (opcional)</label>
              <div className="space-y-2">
                {step.imageUrl ? (
                  <div className="flex items-start gap-3">
                    <img
                      src={step.imageUrl}
                      alt="preview"
                      className="h-20 w-20 rounded-lg border border-slate-200 object-cover shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => sel("imageUrl", "")}
                      className="text-[11px] text-red-500 hover:text-red-700 underline"
                    >
                      Remover imagem
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer w-fit px-3 py-2 rounded-lg border-2 border-dashed border-slate-300 hover:border-violet-400 hover:bg-violet-50 transition text-sm text-slate-500 hover:text-violet-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                      </svg>
                      Fazer upload do PC
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => sel("imageUrl", reader.result as string);
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[10px] text-slate-400">ou cole uma URL</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                    <input
                      value={step.imageUrl ?? ""}
                      onChange={(e) => sel("imageUrl", e.target.value)}
                      placeholder="https://exemplo.com/imagem.jpg"
                      className={inputCls}
                    />
                  </>
                )}
                <p className="text-[10px] text-slate-400">
                  A mensagem de texto será enviada como legenda da foto.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Meta: template selector */}
        {isMeta && step.connectionId && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Selecione o modelo de mensagem</label>
              {approvedTemplates.length === 0 ? (
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-700">
                  Nenhum template aprovado. Importe em <strong>Disparos WA</strong>.
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(byCategory).map(([cat, tpls]) => (
                    <div key={cat}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                        {CATEGORY_LABEL[cat] ?? cat}
                      </p>
                      <div className="space-y-1">
                        {tpls.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onChange({ templateId: t.id, templateVariables: {} })}
                            className={clsx(
                              "w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
                              step.templateId === t.id
                                ? "border-violet-400 bg-violet-50"
                                : "border-slate-200 bg-white hover:border-violet-200",
                            )}
                          >
                            <span className={clsx(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0",
                              CATEGORY_COLOR[cat] ?? "bg-slate-100 text-slate-600",
                            )}>
                              {CATEGORY_LABEL[cat] ?? cat}
                            </span>
                            <span className="font-medium text-slate-800">{t.name}</span>
                            <span className="text-slate-400 text-xs ml-auto shrink-0">{t.language}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Template preview + variables */}
            {tpl && (
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="bg-[#e9f5fe] px-3 py-3 space-y-1 border-b border-slate-200">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Prévia da mensagem</p>
                  {tpl.components.filter((c) => c.type !== "BUTTONS" && c.text).map((c) => (
                    <p key={c.type} className={clsx(
                      "text-sm text-slate-800 whitespace-pre-wrap",
                      c.type === "HEADER" && "font-bold",
                      c.type === "FOOTER" && "text-slate-400 text-[11px]",
                    )}>
                      {c.text!.split(/(\{\{\d+\}\})/).map((part, i) =>
                        /\{\{\d+\}\}/.test(part)
                          ? <span key={i} className="bg-blue-100 text-blue-700 rounded px-0.5 font-mono">{part}</span>
                          : part,
                      )}
                    </p>
                  ))}
                </div>
                {varComps.length > 0 && (
                  <div className="px-3 py-3 space-y-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Preencha as variáveis</p>
                    {varComps.map((comp) => {
                      const matches = [...comp.text!.matchAll(/\{\{(\d+)\}\}/g)];
                      return (
                        <div key={comp.type}>
                          <p className="text-[10px] font-semibold text-slate-500 mb-1.5">
                            {comp.type === "HEADER" ? "🔝 Cabeçalho" : "📝 Corpo da mensagem"}
                          </p>
                          <div className="space-y-1.5">
                            {matches.map((m) => {
                              const idx = parseInt(m[1]) - 1;
                              const current = step.templateVariables[comp.type]?.[idx] ?? "";
                              return (
                                <div key={m[1]} className="flex items-center gap-2">
                                  <span className="text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 shrink-0">
                                    {`{{${m[1]}}}`}
                                  </span>
                                  <div className="flex-1">
                                    <div className="flex gap-1 mb-1">
                                      {["{{nome}}", "{{telefone}}", "{{email}}"].map((v) => (
                                        <button key={v} type="button"
                                          onClick={() => {
                                            const vars = { ...step.templateVariables };
                                            const arr = [...(vars[comp.type] ?? [])];
                                            arr[idx] = v; vars[comp.type] = arr;
                                            sel("templateVariables", vars);
                                          }}
                                          className="rounded bg-violet-100 hover:bg-violet-200 text-violet-700 px-1.5 py-0.5 text-[9px] font-mono transition">
                                          {v.replace(/\{\{|\}\}/g, "")}
                                        </button>
                                      ))}
                                    </div>
                                    <input value={current}
                                      onChange={(e) => {
                                        const vars = { ...step.templateVariables };
                                        const arr = [...(vars[comp.type] ?? [])];
                                        arr[idx] = e.target.value; vars[comp.type] = arr;
                                        sel("templateVariables", vars);
                                      }}
                                      placeholder="Ou digite um valor fixo..."
                                      className={inputCls}
                                    />
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
        )}
      </div>
    );
  }

  if (step.type === "send_list") {
    const uazapiConns2 = connections.filter((c) => c.type === "uazapi");
    return (
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Número de envio (UazapiGO)</label>
          <select value={step.connectionId} onChange={(e) => sel("connectionId", e.target.value)} className={inputCls}>
            {uazapiConns2.length === 0
              ? <option value="">Nenhuma conexão UazapiGO configurada</option>
              : uazapiConns2.map((c) => <option key={c.id} value={c.id}>{c.phone} ({c.funnelName})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Título da lista</label>
            <input value={step.listTitle} onChange={(e) => sel("listTitle", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Texto do botão</label>
            <input value={step.listButtonText} onChange={(e) => sel("listButtonText", e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Opções para o lead escolher</label>
          <div className="space-y-2">
            {step.listRows.map((row, i) => (
              <div key={row.id} className="flex gap-2 items-center">
                <input value={row.title} onChange={(e) => {
                  const rows = [...step.listRows]; rows[i] = { ...rows[i], title: e.target.value }; sel("listRows", rows);
                }} placeholder="Nome da opção" className={clsx(inputCls, "flex-1")} />
                <input value={row.description} onChange={(e) => {
                  const rows = [...step.listRows]; rows[i] = { ...rows[i], description: e.target.value }; sel("listRows", rows);
                }} placeholder="Descrição (opcional)" className={clsx(inputCls, "flex-1")} />
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
        <label className={labelCls}>Texto da nota</label>
        <textarea value={step.note} onChange={(e) => sel("note", e.target.value)} rows={3}
          placeholder="Ex: Lead entrou na proposta. Ligar em 48h."
          className={clsx(inputCls, "resize-none")} />
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {["{{nome}}", "{{telefone}}", "{{funil}}"].map((v) => (
            <button key={v} type="button"
              onClick={() => sel("note", (step.note ?? "") + v)}
              className="rounded bg-slate-100 hover:bg-violet-100 hover:text-violet-700 px-2 py-0.5 text-[10px] font-mono text-slate-600 transition">
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step.type === "move_column") {
    const targetFunnel = funnels.find((f) => f.id === step.targetFunnelId);
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Funil de destino</label>
          <select value={step.targetFunnelId}
            onChange={(e) => { sel("targetFunnelId", e.target.value); sel("targetColumnId", ""); }}
            className={inputCls}>
            <option value="">Mesmo funil do lead</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Etapa de destino <span className="text-red-500">*</span></label>
          {!step.targetFunnelId
            ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-slate-50">← Escolha o funil primeiro</div>
            : <select value={step.targetColumnId} onChange={(e) => sel("targetColumnId", e.target.value)} className={inputCls}>
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
        <label className={labelCls}>Quanto tempo aguardar antes do próximo passo?</label>
        <select value={step.delayMinutes} onChange={(e) => sel("delayMinutes", Number(e.target.value))} className={inputCls}>
          {DELAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  if (step.type === "webhook") {
    return (
      <div className="space-y-3">
        <div>
          <label className={labelCls}>URL do sistema externo (HTTP POST)</label>
          <input value={step.webhookUrl} onChange={(e) => sel("webhookUrl", e.target.value)}
            placeholder="https://seu-sistema.com/webhook"
            className={inputCls} />
          <p className="text-[10px] text-slate-400 mt-1">Os dados do lead serão enviados automaticamente para esta URL.</p>
        </div>
        <div>
          <label className={labelCls}>Dados personalizados (JSON — opcional)</label>
          <textarea value={step.webhookBody} onChange={(e) => sel("webhookBody", e.target.value)} rows={3}
            placeholder={`{"nome": "{{nome}}", "telefone": "{{telefone}}"}`}
            className={clsx(inputCls, "resize-none font-mono")} />
          <p className="text-[10px] text-slate-400 mt-1">Deixe vazio para enviar todos os dados do lead automaticamente.</p>
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
      return `${c?.phone ?? "sem número"} · "${step.message.slice(0, 30)}${step.message.length > 30 ? "…" : ""}"`;
    }
    case "send_template": {
      const c = conns.find((x) => x.id === step.connectionId);
      const t = templates.find((x) => x.id === step.templateId);
      return `${c?.phone ?? "sem número"} · ${t ? t.name : "nenhum template"}`;
    }
    case "send_list": return `"${step.listTitle}" · ${step.listRows.length} opções`;
    case "add_note": return `"${step.note.slice(0, 35)}${step.note.length > 35 ? "…" : ""}"`;
    case "move_column": return step.targetColumnId ? `→ etapa ${step.targetColumnId}` : "Etapa não configurada";
    case "delay": return DELAY_OPTIONS.find((o) => o.value === step.delayMinutes)?.label ?? `${step.delayMinutes}min`;
    case "webhook": return step.webhookUrl ? step.webhookUrl.replace(/^https?:\/\//, "").slice(0, 40) : "URL não configurada";
    default: return "";
  }
}

// ── AutoCard ──────────────────────────────────────────────────────────────────
function AutoCard({
  auto, isEditing, toggling, deleting, funnels, webhooks,
  onEdit, onToggle, onDelete,
}: {
  auto: CrmAutomation; isEditing: boolean; toggling: boolean; deleting: boolean;
  funnels: Funnel[]; webhooks: WebhookConfig[];
  onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const funnel = funnels.find((f) => f.id === auto.funnelId);
  const col = funnel?.columns.find((c) => c.id === auto.triggerColumnId);
  const wh = webhooks.find((w) => w.id === auto.triggerWebhookId);
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
            {wh && <> · <span className="text-violet-600 font-medium">{wh.name}</span></>}
            {funnel && !wh && <> · {funnel.name}</>}
            {col && <> · <span className="font-medium">{col.label}</span></>}
            {auto.trigger === "scheduled_daily" && auto.scheduledTime && <> às <strong>{auto.scheduledTime}</strong></>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {steps.length > 0 ? steps.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                {STEP_ICONS[s.type]} {STEP_LABELS[s.type]}
              </span>
            )) : (
              <span className="text-xs text-slate-400 italic">Automação legada</span>
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
            className="text-slate-400 hover:text-red-500 transition text-lg leading-none px-1">
            {deleting ? "..." : "×"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function CrmAutomationsView({
  clientId, initialAutomations, funnels, connections, approvedTemplates, webhooks,
}: Props) {
  const [automations, setAutomations] = useState<CrmAutomation[]>(initialAutomations);
  const [showForm, setShowForm]         = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [toggling, setToggling]         = useState<string | null>(null);
  const [deleting, setDeleting]         = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [showPicker, setShowPicker]     = useState(false);

  const defaultConnId = (connections.find((c) => c.type === "uazapi") ?? connections.find((c) => c.type === "wppconnect") ?? connections[0])?.id ?? "";
  const uazapiConnId = defaultConnId;
  const firstTplId   = approvedTemplates[0]?.id ?? "";

  const blankFormFn = (): FormState => ({
    name: "", trigger: "lead_created",
    funnelId: "", triggerColumnId: "", triggerWebhookId: "", scheduledTime: "09:00",
    triggerKeywords: [],
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
      triggerWebhookId: auto.triggerWebhookId ?? "",
      scheduledTime: auto.scheduledTime ?? "09:00",
      triggerKeywords: auto.triggerKeywords ?? [],
      steps: stepsFromAuto(auto, uazapiConnId, firstTplId),
    });
    setExpandedStep(null); setShowPicker(false); setEditingId(auto.id); setShowForm(true);
    setTimeout(() => document.getElementById("crm-form")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function closeForm() {
    setShowForm(false); setEditingId(null); setExpandedStep(null); setShowPicker(false);
  }

  function addStep(type: CrmStepType) {
    const s = blankStep(type, uazapiConnId, firstTplId);
    setField("steps", [...form.steps, s]);
    setExpandedStep(s.id); setShowPicker(false);
  }

  function updateStep(id: string, patch: Partial<StepForm>) {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => s.id === id ? { ...s, ...patch } : s),
    }));
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
    const payload = {
      clientId, name: form.name.trim(), trigger: form.trigger,
      funnelId: form.funnelId || undefined,
      triggerColumnId: form.trigger !== "lead_created" ? form.triggerColumnId || undefined : undefined,
      triggerWebhookId: form.trigger === "lead_created" ? form.triggerWebhookId || undefined : undefined,
      scheduledTime: form.trigger === "scheduled_daily" ? form.scheduledTime : undefined,
      triggerKeywords: form.trigger === "message_received" && form.triggerKeywords.length > 0 ? form.triggerKeywords : undefined,
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
      } else {
        const err = await res.json().catch(() => ({}));
        alert("Erro ao salvar: " + (err.error ?? res.status));
      }
    } else {
      const res = await fetch("/api/crm/automations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json() as CrmAutomation;
        setAutomations((prev) => [...prev, created]);
        closeForm();
      } else {
        const err = await res.json().catch(() => ({}));
        alert("Erro ao criar: " + (err.error ?? res.status));
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
  const selectedTrigger = TRIGGER_OPTIONS.find((t) => t.value === form.trigger);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Automações CRM</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Envios automáticos em múltiplos passos disparados por gatilhos do funil.
          </p>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition">
          + Nova Automação
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div id="crm-form" className="rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-violet-600 px-5 py-3">
            <h2 className="font-semibold text-white text-sm">
              {editingId ? "✏ Editar automação" : "⚡ Criar nova automação"}
            </h2>
          </div>

          <div className="p-5 space-y-6">
            {/* Step 1: Name */}
            <div>
              <label className={labelCls}>1 · Nome da automação</label>
              <input value={form.name} onChange={(e) => setField("name", e.target.value)}
                placeholder="ex: Boas-vindas, Follow-up Proposta, Lembrete diário"
                className={inputCls} />
            </div>

            {/* Step 2: Trigger */}
            <div>
              <label className={labelCls}>2 · Quando disparar?</label>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button"
                    onClick={() => { setField("trigger", opt.value); setField("triggerColumnId", ""); setField("triggerWebhookId", ""); setField("triggerKeywords", []); }}
                    className={clsx(
                      "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition",
                      form.trigger === opt.value
                        ? "border-violet-400 bg-violet-50"
                        : "border-slate-200 bg-white hover:border-violet-200",
                    )}>
                    <span className="text-lg shrink-0">{opt.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                      <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{opt.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Trigger config */}
            {selectedTrigger && (
              <div>
                <label className={labelCls}>3 · Configurar o gatilho</label>
                <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-slate-50">

                  {/* lead_created: webhook selector + optional funnel */}
                  {form.trigger === "lead_created" && (
                    <>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">De qual formulário/site?</label>
                        <select value={form.triggerWebhookId} onChange={(e) => setField("triggerWebhookId", e.target.value)} className={inputCls}>
                          <option value="">Qualquer formulário (todos os sites)</option>
                          {webhooks.map((w) => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Deixe em "Qualquer" para disparar quando leads entrarem por qualquer formulário.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Funil (opcional)</label>
                        <select value={form.funnelId} onChange={(e) => setField("funnelId", e.target.value)} className={inputCls}>
                          <option value="">Qualquer funil</option>
                          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {/* column_changed: funnel optional + column optional */}
                  {form.trigger === "column_changed" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Funil (opcional)</label>
                        <select value={form.funnelId}
                          onChange={(e) => { setField("funnelId", e.target.value); setField("triggerColumnId", ""); }}
                          className={inputCls}>
                          <option value="">Qualquer funil</option>
                          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Etapa (opcional)</label>
                        {!form.funnelId
                          ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-white cursor-not-allowed">← Selecione um funil</div>
                          : <select value={form.triggerColumnId} onChange={(e) => setField("triggerColumnId", e.target.value)} className={inputCls}>
                              <option value="">Qualquer etapa</option>
                              {(selectedFunnel?.columns ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>}
                      </div>
                    </div>
                  )}

                  {/* column_entered: funnel required + column */}
                  {form.trigger === "column_entered" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Funil <span className="text-red-500">*</span></label>
                        <select value={form.funnelId}
                          onChange={(e) => { setField("funnelId", e.target.value); setField("triggerColumnId", ""); }}
                          className={inputCls}>
                          <option value="">— Selecione um funil —</option>
                          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Etapa <span className="text-red-500">*</span></label>
                        {!form.funnelId
                          ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-white cursor-not-allowed">← Selecione o funil primeiro</div>
                          : <select value={form.triggerColumnId} onChange={(e) => setField("triggerColumnId", e.target.value)} className={inputCls}>
                              <option value="">— Qualquer etapa —</option>
                              {(selectedFunnel?.columns ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>}
                      </div>
                    </div>
                  )}

                  {/* scheduled_daily */}
                  {form.trigger === "scheduled_daily" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Funil <span className="text-red-500">*</span></label>
                        <select value={form.funnelId}
                          onChange={(e) => { setField("funnelId", e.target.value); setField("triggerColumnId", ""); }}
                          className={inputCls}>
                          <option value="">— Selecione —</option>
                          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Etapa alvo (opcional)</label>
                        {!form.funnelId
                          ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 bg-white cursor-not-allowed">← Selecione o funil</div>
                          : <select value={form.triggerColumnId} onChange={(e) => setField("triggerColumnId", e.target.value)} className={inputCls}>
                              <option value="">Todos os leads do funil</option>
                              {(selectedFunnel?.columns ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>}
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Horário de disparo <span className="text-red-500">*</span></label>
                        <input type="time" value={form.scheduledTime} onChange={(e) => setField("scheduledTime", e.target.value)} className={inputCls} />
                      </div>
                    </div>
                  )}

                  {/* message_received: funil opcional + keywords */}
                  {form.trigger === "message_received" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Funil (opcional)</label>
                        <select value={form.funnelId} onChange={(e) => setField("funnelId", e.target.value)} className={inputCls}>
                          <option value="">Qualquer funil</option>
                          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">
                          Palavras ou frases que ativam <span className="text-slate-400 font-normal">(uma por linha, sem diferença de maiúsculas)</span>
                        </label>
                        <textarea
                          rows={4}
                          placeholder={"quero comprar\npreciso de informações\norçamento"}
                          value={form.triggerKeywords.join("\n")}
                          onChange={(e) => {
                            const lines = e.target.value.split("\n").map((l) => l.trimStart());
                            setField("triggerKeywords", lines);
                          }}
                          className={inputCls + " resize-none font-mono text-xs"}
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          A automação dispara se a mensagem do lead <strong>contiver</strong> qualquer uma das frases acima. Deixe em branco para disparar em qualquer mensagem.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 4: Steps */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className={labelCls}>4 · O que fazer?</label>
                <span className="text-xs text-slate-400">{form.steps.length} {form.steps.length === 1 ? "passo" : "passos"}</span>
              </div>

              {form.steps.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                  Nenhum passo adicionado ainda.
                </div>
              )}

              <div className="space-y-2">
                {form.steps.map((step, idx) => (
                  <div key={step.id} className={clsx(
                    "rounded-lg border bg-white",
                    expandedStep === step.id ? "border-violet-300 shadow-sm" : "border-slate-200",
                  )}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
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
                          {expandedStep === step.id ? "Fechar" : "Configurar"}
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
              <div className="mt-2">
                <button onClick={() => setShowPicker((v) => !v)}
                  className="w-full rounded-lg border border-dashed border-violet-300 px-3 py-2.5 text-sm text-violet-600 hover:bg-violet-50 transition font-medium flex items-center justify-center gap-2">
                  <span className="text-base">{showPicker ? "−" : "+"}</span> {showPicker ? "Fechar" : "Adicionar passo"}
                </button>
                {showPicker && (
                  <div className="mt-2 border border-slate-200 rounded-xl bg-white p-2 grid grid-cols-2 gap-1">
                    {STEP_PICKER_OPTIONS.map((opt) => (
                      <button key={opt.type} onClick={() => addStep(opt.type)}
                        className="flex items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-violet-50 hover:text-violet-700 transition group">
                        <span className="text-lg shrink-0 mt-0.5">{opt.icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 group-hover:text-violet-700">{opt.label}</p>
                          <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{opt.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Save/Cancel */}
            <div className="flex gap-2 pt-1 border-t border-slate-100">
              <button onClick={save} disabled={saving || !form.name.trim() || form.steps.length === 0}
                className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition">
                {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar Automação"}
              </button>
              <button onClick={closeForm}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Automations list */}
      {automations.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
          <div className="text-5xl mb-3">⚡</div>
          <p className="font-semibold text-slate-700">Nenhuma automação criada</p>
          <p className="text-sm text-slate-400 mt-1">Configure fluxos automáticos com múltiplos passos.</p>
          <button onClick={openNew} className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
            Criar primeira automação
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((auto) => (
            <AutoCard key={auto.id} auto={auto}
              isEditing={editingId === auto.id}
              toggling={toggling === auto.id} deleting={deleting === auto.id}
              funnels={funnels} webhooks={webhooks}
              onEdit={() => editingId === auto.id ? closeForm() : openEdit(auto)}
              onToggle={() => toggleActive(auto)}
              onDelete={() => remove(auto.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
