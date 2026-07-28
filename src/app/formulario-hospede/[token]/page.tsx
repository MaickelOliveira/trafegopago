"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Hospede = {
  nome: string;
  nascimento: string;
  cpf: string;
  rg: string;
  profissao: string;
  endereco: string;
  cidadeEstado: string;
  telefone: string;
  email: string;
};

function emptyHospede(): Hospede {
  return { nome: "", nascimento: "", cpf: "", rg: "", profissao: "", endereco: "", cidadeEstado: "", telefone: "", email: "" };
}

// Todos obrigatórios — são exatamente os dados que a pousada exige de cada
// hóspede pra confirmar a reserva (ver regra 19 do prompt: CPF nunca pode
// faltar, sem exceção).
const FIELDS: { key: keyof Hospede; label: string; required?: boolean; type?: string }[] = [
  { key: "nome", label: "Nome completo", required: true },
  { key: "nascimento", label: "Data de nascimento", type: "date", required: true },
  { key: "cpf", label: "CPF", required: true },
  { key: "rg", label: "RG", required: true },
  { key: "profissao", label: "Profissão", required: true },
  { key: "endereco", label: "Endereço completo", required: true },
  { key: "cidadeEstado", label: "Cidade/Estado", required: true },
  { key: "telefone", label: "Telefone", required: true },
  { key: "email", label: "E-mail", type: "email", required: true },
];

export default function GuestFormPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [hospedes, setHospedes] = useState<Hospede[]>([emptyHospede()]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/guest-forms/${token}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data) => {
        setClientName(data.clientName ?? "");
        if (data.status === "submitted") setSubmitted(true);
      })
      .catch(() => setError("Não foi possível carregar este formulário. Verifique se o link está correto."))
      .finally(() => setLoading(false));
  }, [token]);

  function updateHospede(i: number, key: keyof Hospede, value: string) {
    setHospedes((prev) => prev.map((h, idx) => (idx === i ? { ...h, [key]: value } : h)));
  }

  function addHospede() {
    setHospedes((prev) => [...prev, emptyHospede()]);
  }

  function removeHospede(i: number) {
    setHospedes((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    const requiredKeys = FIELDS.filter((f) => f.required).map((f) => f.key);
    const missing = hospedes.some((h) => requiredKeys.some((k) => !h[k]?.trim()));
    if (missing) {
      setSubmitError("Preencha todos os campos de cada hóspede antes de enviar.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/guest-forms/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pessoas: hospedes }),
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
            Obrigado por preencher a ficha de hóspedes. Volte para a conversa no WhatsApp — em instantes você recebe os detalhes de pagamento para confirmar a reserva.
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
          <h1 className="text-xl font-semibold text-slate-900">{clientName || "Ficha de Hóspedes"}</h1>
          <p className="text-sm text-slate-500">
            Preencha os dados de cada pessoa que vai se hospedar para confirmarmos sua reserva.
          </p>
        </div>

        <div className="space-y-4">
          {hospedes.map((h, i) => (
            <div key={i} className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-emerald-700">Hóspede {i + 1}</p>
                {hospedes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeHospede(i)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remover
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <div key={f.key} className={f.key === "nome" || f.key === "endereco" ? "sm:col-span-2" : ""}>
                    <label className="text-xs font-medium text-slate-600 block mb-1">
                      {f.label}{f.required ? " *" : ""}
                    </label>
                    <input
                      type={f.type ?? "text"}
                      value={h[f.key]}
                      onChange={(e) => updateHospede(i, f.key, e.target.value)}
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
          onClick={addHospede}
          className="w-full rounded-lg border border-dashed border-emerald-300 text-emerald-700 text-sm py-2.5 hover:bg-emerald-100"
        >
          + Adicionar hóspede
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
