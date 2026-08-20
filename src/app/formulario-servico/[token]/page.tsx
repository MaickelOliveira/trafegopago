"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Participante = {
  nome: string;
  telefone: string;
  idade: string;
};

function emptyParticipante(): Participante {
  return { nome: "", telefone: "", idade: "" };
}

const FIELDS: { key: keyof Participante; label: string; type?: string }[] = [
  { key: "nome", label: "Nome completo" },
  { key: "telefone", label: "Telefone" },
  { key: "idade", label: "Idade", type: "number" },
];

export default function ServicoFormPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [dataServico, setDataServico] = useState("");
  const [participantes, setParticipantes] = useState<Participante[]>([emptyParticipante()]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tipoLabel, setTipoLabel] = useState("");

  useEffect(() => {
    fetch(`/api/servico-forms/${token}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data) => {
        setClientName(data.clientName ?? "");
        setTipoLabel(data.tipoLabel ?? "");
        if (data.status === "submitted") setSubmitted(true);
      })
      .catch(() => setError("Não foi possível carregar este formulário. Verifique se o link está correto."))
      .finally(() => setLoading(false));
  }, [token]);

  function updateParticipante(i: number, key: keyof Participante, value: string) {
    setParticipantes((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  }

  function addParticipante() {
    setParticipantes((prev) => [...prev, emptyParticipante()]);
  }

  function removeParticipante(i: number) {
    setParticipantes((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (!dataServico) {
      setSubmitError("Informe a data antes de enviar.");
      return;
    }
    const missing = participantes.some((p) => !p.nome.trim() || !p.telefone.trim() || !p.idade.trim());
    if (missing) {
      setSubmitError("Preencha nome, telefone e idade de cada participante antes de enviar.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const pessoas = participantes.map((p) => ({
        nome: p.nome.trim(),
        telefone: p.telefone.trim(),
        idade: Number(p.idade),
      }));
      const res = await fetch(`/api/servico-forms/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pessoas, data: dataServico }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setSubmitError(data?.error ?? "Não foi possível enviar. Tente novamente.");
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError("Não foi possível enviar. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50">
        <p className="text-emerald-700 text-sm">Carregando formulário...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 px-4">
        <div className="max-w-sm text-center">
          <p className="text-4xl mb-3">🌿</p>
          <p className="text-slate-700">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 px-4">
        <div className="max-w-sm text-center bg-white rounded-2xl border border-emerald-100 shadow-sm p-8">
          <p className="text-4xl mb-3">✅</p>
          <h1 className="text-lg font-semibold text-slate-900 mb-2">Dados recebidos!</h1>
          <p className="text-sm text-slate-500">
            Obrigado por preencher a ficha de participantes. Volte para a conversa no WhatsApp — em instantes você recebe os próximos passos para confirmar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-emerald-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-1">
          <p className="text-3xl">🌿</p>
          <h1 className="text-xl font-semibold text-slate-900">{clientName || "Ficha de Participantes"}</h1>
          {tipoLabel && (
            <p className="text-sm font-medium text-emerald-700">{tipoLabel}</p>
          )}
          <p className="text-sm text-slate-500">
            Preencha nome, telefone e idade de cada pessoa que vai participar para confirmarmos sua reserva.
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
          <label className="text-xs font-medium text-slate-600 block mb-1">
            Data *
          </label>
          <input
            type="date"
            value={dataServico}
            onChange={(e) => setDataServico(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </div>

        <div className="space-y-4">
          {participantes.map((p, i) => (
            <div key={i} className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-emerald-700">Participante {i + 1}</p>
                {participantes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeParticipante(i)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remover
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {FIELDS.map((f) => (
                  <div key={f.key} className={f.key === "nome" ? "sm:col-span-3" : ""}>
                    <label className="text-xs font-medium text-slate-600 block mb-1">
                      {f.label} *
                    </label>
                    <input
                      type={f.type ?? "text"}
                      min={f.type === "number" ? 0 : undefined}
                      value={p[f.key]}
                      onChange={(e) => updateParticipante(i, f.key, e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addParticipante}
          className="w-full rounded-lg border border-dashed border-emerald-300 text-emerald-700 text-sm py-2.5 hover:bg-emerald-100"
        >
          + Adicionar participante
        </button>

        {submitError && <p className="text-sm text-red-600 text-center">{submitError}</p>}

        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="w-full rounded-lg bg-emerald-600 text-white text-sm font-medium py-3 hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Enviando..." : "Enviar dados"}
        </button>
      </div>
    </div>
  );
}
