"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { Reserva, Pessoa, PousadaTipo, StatusReserva } from "@/lib/pousada-types";

type PessoaForm = Pessoa & { _expanded?: boolean };

function emptyPessoa(): PessoaForm {
  return { nome: "", idade: undefined, valor: 0, gratuito: false, _expanded: false };
}

function sumPessoas(pessoas: PessoaForm[]): number {
  return pessoas.reduce((s, p) => s + (p.gratuito ? 0 : Number(p.valor) || 0), 0);
}

export function ReservaModal({
  clientId,
  tipos,
  initial,
  onSave,
  onClose,
}: {
  clientId: string;
  tipos: PousadaTipo[];
  initial?: Reserva | null;
  onSave: (r: Reserva) => void;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    tipo: initial?.tipo ?? tipos[0]?.slug ?? "",
    data: initial?.data ?? today,
    hora: initial?.hora ?? "",
    responsavelNome: initial?.responsavel.nome ?? "",
    responsavelCpf: initial?.responsavel.cpf ?? "",
    telefone: initial?.telefone ?? "",
    cidade: initial?.cidade ?? "",
    observacoes: initial?.observacoes ?? "",
    status: (initial?.status ?? "pendente") as StatusReserva,
    valorTotal: initial?.valorTotal?.toString() ?? "0",
    valorPago: initial?.valorPago?.toString() ?? "0",
  });
  const [pessoas, setPessoas] = useState<PessoaForm[]>(
    initial?.pessoas?.length ? initial.pessoas.map((p) => ({ ...p, _expanded: false })) : [emptyPessoa()]
  );
  const [saving, setSaving] = useState(false);

  function updatePessoa(i: number, patch: Partial<PessoaForm>) {
    setPessoas((prev) => {
      const next = prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
      setForm((f) => ({ ...f, valorTotal: String(sumPessoas(next)) }));
      return next;
    });
  }

  function addPessoa() {
    setPessoas((prev) => [...prev, emptyPessoa()]);
  }

  function removePessoa(i: number) {
    setPessoas((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      setForm((f) => ({ ...f, valorTotal: String(sumPessoas(next)) }));
      return next;
    });
  }

  const valorTotalNum = Number(form.valorTotal) || 0;
  const valorPagoNum = Number(form.valorPago) || 0;
  const faltaPagar = Math.max(valorTotalNum - valorPagoNum, 0);

  const canSave = form.responsavelNome.trim().length > 0 && pessoas.some((p) => p.nome.trim().length > 0);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = {
        clientId,
        tipo: form.tipo,
        data: form.data,
        hora: form.hora || undefined,
        responsavel: { nome: form.responsavelNome, cpf: form.responsavelCpf || undefined },
        telefone: form.telefone || undefined,
        cidade: form.cidade || undefined,
        observacoes: form.observacoes || undefined,
        status: form.status,
        valorTotal: valorTotalNum,
        valorPago: valorPagoNum,
        faltaPagar,
        pessoas: pessoas
          .filter((p) => p.nome.trim().length > 0)
          .map(({ _expanded, ...p }) => p),
      };
      const url = initial ? `/api/pousada/reservas/${initial.id}` : "/api/pousada/reservas";
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = await res.json();
      if (res.ok) { onSave(r); onClose(); }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold text-slate-900">{initial ? "Editar" : "Nova"} reserva</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Tipo *</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 bg-white"
              >
                {tipos.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as StatusReserva }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 bg-white"
              >
                <option value="pendente">Pendente</option>
                <option value="parcial">Parcial</option>
                <option value="pago">Pago</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Data *</label>
              <input type="date" value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Hora</label>
              <input type="time" value={form.hora} onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 block mb-1">Responsável (nome completo) *</label>
              <input value={form.responsavelNome} onChange={(e) => setForm((f) => ({ ...f, responsavelNome: e.target.value }))}
                placeholder="Nome de quem faz a reserva"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">CPF do responsável</label>
              <input value={form.responsavelCpf} onChange={(e) => setForm((f) => ({ ...f, responsavelCpf: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Telefone</label>
              <input value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 block mb-1">Cidade</label>
              <input value={form.cidade} onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
          </div>

          {/* Hóspedes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Hóspedes / participantes</label>
              <button type="button" onClick={addPessoa} className="text-xs font-medium text-amber-700 hover:text-amber-800">
                + Adicionar pessoa
              </button>
            </div>
            <div className="space-y-2">
              {pessoas.map((p, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <input
                      value={p.nome}
                      onChange={(e) => updatePessoa(i, { nome: e.target.value })}
                      placeholder="Nome"
                      className="col-span-5 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
                    />
                    <input
                      value={p.idade ?? ""}
                      onChange={(e) => updatePessoa(i, { idade: e.target.value ? Number(e.target.value) : undefined })}
                      type="number" min="0" placeholder="Idade"
                      className="col-span-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
                    />
                    <input
                      value={p.valor}
                      onChange={(e) => updatePessoa(i, { valor: Number(e.target.value) || 0 })}
                      type="number" step="0.01" placeholder="Valor" disabled={!!p.gratuito}
                      className="col-span-3 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-amber-400 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <label className="col-span-1 flex items-center justify-center" title="Gratuito">
                      <input type="checkbox" checked={!!p.gratuito}
                        onChange={(e) => updatePessoa(i, { gratuito: e.target.checked, valor: e.target.checked ? 0 : p.valor })}
                        className="h-4 w-4 rounded accent-amber-600" />
                    </label>
                    <div className="col-span-1 flex items-center justify-end gap-1">
                      {pessoas.length > 1 && (
                        <button type="button" onClick={() => removePessoa(i)} className="text-slate-400 hover:text-red-500 text-lg leading-none">×</button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePessoa(i, { _expanded: !p._expanded })}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    {p._expanded ? "− ocultar detalhes" : "+ mais detalhes (CPF, RG, endereço...)"}
                  </button>
                  {p._expanded && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <input value={p.cpf ?? ""} onChange={(e) => updatePessoa(i, { cpf: e.target.value })} placeholder="CPF"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input value={p.rg ?? ""} onChange={(e) => updatePessoa(i, { rg: e.target.value })} placeholder="RG"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input type="date" value={p.nascimento ?? ""} onChange={(e) => updatePessoa(i, { nascimento: e.target.value })}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input value={p.profissao ?? ""} onChange={(e) => updatePessoa(i, { profissao: e.target.value })} placeholder="Profissão"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input value={p.endereco ?? ""} onChange={(e) => updatePessoa(i, { endereco: e.target.value })} placeholder="Endereço"
                        className="col-span-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input value={p.cidade ?? ""} onChange={(e) => updatePessoa(i, { cidade: e.target.value })} placeholder="Cidade"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input value={p.telefone ?? ""} onChange={(e) => updatePessoa(i, { telefone: e.target.value })} placeholder="Telefone"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                      <input value={p.email ?? ""} onChange={(e) => updatePessoa(i, { email: e.target.value })} placeholder="E-mail"
                        className="col-span-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Valores */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Valor total (R$)</label>
              <input value={form.valorTotal} onChange={(e) => setForm((f) => ({ ...f, valorTotal: e.target.value }))}
                type="number" step="0.01"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Valor pago (R$)</label>
              <input value={form.valorPago} onChange={(e) => setForm((f) => ({ ...f, valorPago: e.target.value }))}
                type="number" step="0.01"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Falta pagar</label>
              <div className="w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {faltaPagar.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Observações</label>
            <textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !canSave}
            className={clsx(
              "flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50",
              "bg-amber-600 hover:bg-amber-700"
            )}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
