"use client";

import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

interface ColumnMapping {
  name: string;
  phone: string;
  email: string;
  stage: string;
  notes: string;
  value: string;
}

interface ImportResult {
  funnelId: string;
  funnelName: string;
  created: number;
  skipped: number;
  errors: number;
  total: number;
}

interface Props {
  clientId: string;
  onClose: () => void;
  onImported: (funnelId: string) => void;
}

const KOMMO_HINTS: Record<keyof ColumnMapping, string[]> = {
  name:  ["nome", "name", "contact name", "contato", "cliente"],
  phone: ["telefone", "phone", "fone", "celular", "whatsapp", "tel"],
  email: ["email", "e-mail", "correio"],
  stage: ["etapa", "stage", "status", "fase", "pipeline stage", "estágio"],
  notes: ["anotações", "notes", "obs", "observações", "nota", "comentário"],
  value: ["valor", "value", "deal value", "receita"],
};

function detectMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase().trim());
  function find(hints: string[]) {
    for (const h of hints) {
      const idx = lower.findIndex((l) => l === h || l.includes(h));
      if (idx >= 0) return headers[idx];
    }
    return "";
  }
  return {
    name:  find(KOMMO_HINTS.name),
    phone: find(KOMMO_HINTS.phone),
    email: find(KOMMO_HINTS.email),
    stage: find(KOMMO_HINTS.stage),
    notes: find(KOMMO_HINTS.notes),
    value: find(KOMMO_HINTS.value),
  };
}

type Step = "upload" | "mapping" | "confirm" | "result";

export default function ImportModal({ clientId, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ name: "", phone: "", email: "", stage: "", notes: "", value: "" });
  const [uniqueStages, setUniqueStages] = useState<string[]>([]);
  const [funnelName, setFunnelName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function parseFile(f: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        if (rows.length === 0) { setError("Planilha vazia."); return; }

        const hdrs = Object.keys(rows[0]);
        setHeaders(hdrs);
        setPreview(rows.slice(0, 3));
        const detected = detectMapping(hdrs);
        setMapping(detected);
        setFile(f);
        setStep("mapping");
        setError("");
      } catch {
        setError("Não foi possível ler o arquivo. Verifique se é .xlsx ou .csv válido.");
      }
    };
    reader.readAsArrayBuffer(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);

  function goToConfirm() {
    if (!mapping.phone) { setError("Mapeie a coluna de telefone."); return; }
    if (!mapping.stage) { setError("Mapeie a coluna de etapa."); return; }
    // calcula etapas únicas
    const stages: string[] = [];
    const seen = new Set<string>();
    for (const row of preview) {
      // preview só tem 3 linhas — usamos os dados já parsed para calcular a lista completa
    }
    // Re-parse completo para etapas — usamos o mesmo file
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
      for (const row of rows) {
        const s = String(row[mapping.stage] ?? "").trim();
        if (s && !seen.has(s)) { seen.add(s); stages.push(s); }
      }
      setUniqueStages(stages);
      const today = new Date().toLocaleDateString("pt-BR");
      setFunnelName(`Importação Kommo — ${today}`);
      setStep("confirm");
      setError("");
    };
    reader.readAsArrayBuffer(file!);
  }

  async function doImport() {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientId", clientId);
      fd.append("funnelName", funnelName);
      fd.append("mapping", JSON.stringify(mapping));

      const res = await fetch("/api/crm/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Erro na importação"); setLoading(false); return; }
      setResult(json);
      setStep("result");
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
    name: "Nome do contato", phone: "Telefone *", email: "E-mail",
    stage: "Etapa (coluna) *", notes: "Anotações / Notas", value: "Valor do negócio",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Importar leads do Kommo</h2>
            <p className="text-xs text-slate-500 mt-0.5">Aceita arquivos .xlsx e .csv exportados do Kommo CRM</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        {/* Stepper */}
        <div className="flex gap-0 px-6 pt-4">
          {(["upload","mapping","confirm","result"] as Step[]).map((s, i) => {
            const labels = ["Arquivo","Colunas","Confirmar","Resultado"];
            const active = step === s;
            const done = (["upload","mapping","confirm","result"] as Step[]).indexOf(step) > i;
            return (
              <div key={s} className="flex items-center">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${active ? "text-blue-600" : done ? "text-green-600" : "text-slate-400"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${active ? "bg-blue-600 text-white border-blue-600" : done ? "bg-green-500 text-white border-green-500" : "border-slate-300 text-slate-400"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  {labels[i]}
                </div>
                {i < 3 && <div className="w-6 h-px bg-slate-200 mx-1" />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* STEP 1: Upload */}
          {step === "upload" && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"}`}
            >
              <div className="text-4xl mb-3">📂</div>
              <p className="font-semibold text-slate-700">Arraste o arquivo aqui ou clique para selecionar</p>
              <p className="text-sm text-slate-400 mt-1">Formatos aceitos: .xlsx e .csv</p>
              <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFile} />
            </div>
          )}

          {/* STEP 2: Mapeamento */}
          {step === "mapping" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Verifique o mapeamento automático das colunas. Corrija se necessário.</p>

              {/* Preview */}
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="text-xs w-full">
                  <thead className="bg-slate-50">
                    <tr>{headers.slice(0, 6).map((h) => <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 truncate max-w-[120px]">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {headers.slice(0, 6).map((h) => <td key={h} className="px-3 py-1.5 text-slate-600 truncate max-w-[120px]">{row[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mapping dropdowns */}
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(FIELD_LABELS) as (keyof ColumnMapping)[]).map((field) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{FIELD_LABELS[field]}</label>
                    <select
                      value={mapping[field]}
                      onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                    >
                      <option value="">— não mapear —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: Confirmação */}
          {step === "confirm" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do funil a criar</label>
                <input
                  value={funnelName}
                  onChange={(e) => setFunnelName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
              </div>

              <div className="rounded-xl bg-slate-50 p-4 space-y-2">
                <p className="text-sm font-semibold text-slate-700">Resumo da importação</p>
                <div className="flex gap-6 text-sm text-slate-600">
                  <span>📊 <b>{preview.length}+</b> leads</span>
                  <span>📋 <b>{uniqueStages.length}</b> etapas únicas</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Etapas que serão criadas no funil</p>
                <div className="flex flex-wrap gap-2">
                  {uniqueStages.map((s, i) => (
                    <span key={s} className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ backgroundColor: ["#6366F1","#3B82F6","#F59E0B","#F97316","#10B981","#EF4444","#8B5CF6","#06B6D4","#84CC16","#EC4899"][i % 10] }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Resultado */}
          {step === "result" && result && (
            <div className="space-y-4 text-center py-4">
              <div className="text-5xl">✅</div>
              <p className="text-lg font-semibold text-slate-800">Importação concluída!</p>
              <div className="flex justify-center gap-6 text-sm">
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-bold text-green-600">{result.created}</span>
                  <span className="text-slate-500">criados</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-bold text-yellow-500">{result.skipped}</span>
                  <span className="text-slate-500">ignorados</span>
                </div>
                {result.errors > 0 && (
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-bold text-red-500">{result.errors}</span>
                    <span className="text-slate-500">erros</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400">Funil criado: <b>{result.funnelName}</b></p>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            {step === "result" ? "Fechar" : "Cancelar"}
          </button>
          <div className="flex gap-2">
            {step === "mapping" && (
              <button onClick={() => setStep("upload")} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">← Voltar</button>
            )}
            {step === "confirm" && (
              <button onClick={() => setStep("mapping")} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">← Voltar</button>
            )}
            {step === "mapping" && (
              <button onClick={goToConfirm} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                Continuar →
              </button>
            )}
            {step === "confirm" && (
              <button onClick={doImport} disabled={loading || !funnelName.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {loading ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Importando...</> : "📥 Importar agora"}
              </button>
            )}
            {step === "result" && result && (
              <button
                onClick={() => { onImported(result.funnelId); onClose(); }}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                Ver funil importado →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
