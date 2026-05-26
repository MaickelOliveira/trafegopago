"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { WebhookConfig } from "@/lib/webhooks";
import type { Funnel } from "@/lib/funnels";

type Props = {
  clientId: string;
  funnels: Funnel[];
  initialWebhooks: WebhookConfig[];
  baseUrl: string;
};

export function WebhooksView({ clientId, funnels, initialWebhooks, baseUrl }: Props) {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>(initialWebhooks);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [funnelId, setFunnelId] = useState(funnels[0]?.id ?? "");
  const [columnId, setColumnId] = useState(funnels[0]?.columns[0]?.id ?? "");
  const [nameField, setNameField] = useState("name");
  const [phoneField, setPhoneField] = useState("phone");
  const [emailField, setEmailField] = useState("email");

  const selectedFunnel = funnels.find((f) => f.id === funnelId);

  function handleFunnelChange(id: string) {
    setFunnelId(id);
    const f = funnels.find((ff) => ff.id === id);
    setColumnId(f?.columns[0]?.id ?? "");
  }

  async function create() {
    if (!name.trim() || !funnelId || !columnId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/crm/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          funnelId,
          columnId,
          name: name.trim(),
          fieldMapping: { nameField, phoneField, emailField: emailField || undefined },
          active: true,
        }),
      });
      const wh = await res.json();
      setWebhooks([...webhooks, wh]);
      setShowForm(false);
      setName("");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Deletar este webhook?")) return;
    setDeleting(id);
    await fetch(`/api/crm/webhooks/${id}`, { method: "DELETE" });
    setWebhooks(webhooks.filter((w) => w.id !== id));
    setDeleting(null);
  }

  function copyUrl(id: string) {
    const url = `${baseUrl}/api/wh/${id}`;
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const webhookUrl = (id: string) => `${baseUrl}/api/wh/${id}`;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Webhooks de Entrada</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Receba leads de formulários nas suas páginas de vendas automaticamente.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition"
        >
          + Novo Webhook
        </button>
      </div>

      {/* Formulário de criação */}
      {showForm && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Configurar novo webhook</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nome do Webhook</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Página de Vendas Principal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Funil de Destino</label>
              <select
                value={funnelId}
                onChange={(e) => handleFunnelChange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
              >
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Coluna do Kanban</label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
              >
                {selectedFunnel?.columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-violet-200 pt-3">
            <p className="text-xs font-semibold text-slate-600 mb-2">Mapeamento de Campos (nomes dos campos no POST)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Campo "Nome"</label>
                <input
                  value={nameField}
                  onChange={(e) => setNameField(e.target.value)}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Campo "Telefone"</label>
                <input
                  value={phoneField}
                  onChange={(e) => setPhoneField(e.target.value)}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Campo "E-mail" (opcional)</label>
                <input
                  value={emailField}
                  onChange={(e) => setEmailField(e.target.value)}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              Campos comuns como <code>nome</code>, <code>telefone</code>, <code>celular</code>, <code>email</code> são detectados automaticamente mesmo sem configuração.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={create}
              disabled={saving || !name.trim() || !funnelId}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition"
            >
              {saving ? "Criando..." : "Criar Webhook"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de webhooks */}
      {webhooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
          <div className="text-4xl mb-2">🔗</div>
          <p className="font-medium">Nenhum webhook criado</p>
          <p className="text-sm mt-1">Crie um webhook e cole a URL no seu formulário ou página de vendas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => {
            const funnel = funnels.find((f) => f.id === wh.funnelId);
            const column = funnel?.columns.find((c) => c.id === wh.columnId);
            const url = webhookUrl(wh.id);

            return (
              <div key={wh.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800 text-sm">{wh.name}</span>
                      <span className={clsx(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        wh.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                      )}>
                        {wh.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
                      <span>📂 {funnel?.name ?? wh.funnelId}</span>
                      {column && (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ background: column.color }} />
                          {column.label}
                        </span>
                      )}
                      <span>👥 {wh.leadCount} leads recebidos</span>
                    </div>

                    {/* URL do webhook */}
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700 font-mono truncate">
                        POST {url}
                      </code>
                      <button
                        onClick={() => copyUrl(wh.id)}
                        className={clsx(
                          "rounded-lg px-3 py-1.5 text-xs font-semibold transition shrink-0",
                          copied === wh.id
                            ? "bg-green-500 text-white"
                            : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                        )}
                      >
                        {copied === wh.id ? "✓ Copiado!" : "Copiar URL"}
                      </button>
                    </div>

                    {/* Campos mapeados */}
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      Campos: nome=<code>{wh.fieldMapping.nameField}</code> · telefone=<code>{wh.fieldMapping.phoneField}</code>
                      {wh.fieldMapping.emailField && <> · email=<code>{wh.fieldMapping.emailField}</code></>}
                      {" "}— aceita também UTMs, fbclid, gclid automaticamente
                    </p>
                  </div>

                  <button
                    onClick={() => remove(wh.id)}
                    disabled={deleting === wh.id}
                    className="text-slate-400 hover:text-red-500 transition text-lg leading-none shrink-0 mt-0.5"
                    title="Deletar"
                  >
                    {deleting === wh.id ? "..." : "×"}
                  </button>
                </div>

                {/* Exemplo de uso */}
                <details className="mt-3">
                  <summary className="text-[11px] text-violet-600 cursor-pointer hover:underline">
                    Ver exemplos de integração
                  </summary>
                  <div className="mt-2 rounded-lg bg-slate-900 text-green-300 text-[11px] font-mono p-3 space-y-2">
                    <p className="text-slate-400"># cURL</p>
                    <p className="break-all">{`curl -X POST ${url} \\`}</p>
                    <p className="pl-4">{`  -H "Content-Type: application/json" \\`}</p>
                    <p className="pl-4">{`  -d '{"${wh.fieldMapping.nameField}":"João Silva","${wh.fieldMapping.phoneField}":"5511999991234","utm_source":"facebook"}'`}</p>
                    <p className="mt-2 text-slate-400"># JavaScript (fetch)</p>
                    <p>{`fetch("${url}", { method:"POST", headers:{"Content-Type":"application/json"},`}</p>
                    <p className="pl-4">{`body: JSON.stringify({ ${wh.fieldMapping.nameField}: name, ${wh.fieldMapping.phoneField}: phone }) })`}</p>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
