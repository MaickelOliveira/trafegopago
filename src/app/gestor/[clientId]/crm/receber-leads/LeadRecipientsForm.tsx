"use client";

import Link from "next/link";
import { useState } from "react";
import { RecipientList } from "@/components/agent/RecipientList";
import type { AvisoRecipient } from "@/lib/clients";

type Connection = { id: string; type: "meta" | "evolution"; label: string; recipients: AvisoRecipient[] };

export function LeadRecipientsForm({ clientId, connections }: { clientId: string; connections: Connection[] }) {
  const [selected, setSelected] = useState(connections[0].id);
  const [saved, setSaved] = useState<Record<string, AvisoRecipient[]>>(() =>
    Object.fromEntries(connections.map(c => [c.id, c.recipients]))
  );
  const [drafts, setDrafts] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const connection = connections.find(c => c.id === selected)!;
  const evolution = connection.type === "evolution";
  const dirty = drafts[selected] !== saved[selected];

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ clientId, connId: selected });
      const response = await fetch(`/api/agent?${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadRecipients: drafts[selected] }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível salvar os destinatários.");
      }
      setSaved(previous => ({ ...previous, [selected]: drafts[selected] }));
      setMessage("Destinatários salvos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={saving} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <label className="block text-sm font-semibold text-slate-700">Conexão de WhatsApp
        <select className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={selected} onChange={e => { setSelected(e.target.value); setMessage(""); }}>
          {connections.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <RecipientList key={selected} title="Destinatários"
        description={evolution ? "Adicione um número ou escolha um grupo desta conexão." : "Adicione o número que deve receber os leads."}
        recipients={drafts[selected]} allowGroups={evolution}
        groupsUrl={evolution ? `/api/whatsapp/evolution-manager/${encodeURIComponent(selected)}/groups` : undefined}
        onChange={recipients => { setDrafts(previous => ({ ...previous, [selected]: recipients })); setMessage(""); }}
      />
      {!evolution && <p className="text-xs text-slate-500">Fora da janela de atendimento, o envio usa o <Link
        href={`/gestor/${encodeURIComponent(clientId)}/agente?connId=${encodeURIComponent(selected)}`}
        className="text-blue-700 underline">template Meta configurado em Avisos</Link>.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!dirty || saving} onClick={save}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar destinatários"}
        </button>
        <span role="status" className="text-sm text-slate-600">{message || (dirty ? "Alterações por salvar." : "")}</span>
      </div>
    </fieldset>
  );
}
