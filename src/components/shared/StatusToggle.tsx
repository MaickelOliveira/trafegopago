"use client";

import { useState } from "react";
import { clsx } from "clsx";

interface StatusToggleProps {
  id: string;
  status: string;
  onToggled?: (newStatus: "ACTIVE" | "PAUSED") => void;
  disabled?: boolean;
  /** Base do endpoint de status (sem o /id). Default: Meta. */
  endpoint?: string;
  /** Campos extras enviados no body do POST (ex: accountId, exigido pelo Google Ads). */
  extraBody?: Record<string, string>;
}

export function StatusToggle({ id, status, onToggled, disabled, endpoint = "/api/meta/status", extraBody }: StatusToggleProps) {
  const isActive = status === "ACTIVE";
  const [loading, setLoading] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const current = optimistic !== null ? optimistic : isActive;

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading || disabled) return;

    const next = current ? "PAUSED" : "ACTIVE";
    setOptimistic(!current);
    setLoading(true);

    try {
      const res = await fetch(`${endpoint}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...extraBody }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOptimistic(null); // revert
        alert(data.error || "Erro ao alterar status");
        return;
      }
      onToggled?.(next);
    } catch {
      setOptimistic(null);
      alert("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading || disabled}
      title={current ? "Pausar" : "Ativar"}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
        "focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        current ? "bg-green-500" : "bg-slate-300"
      )}
    >
      <span
        className={clsx(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200",
          current ? "translate-x-4" : "translate-x-0"
        )}
      />
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full border border-white border-t-transparent animate-spin" />
        </span>
      )}
    </button>
  );
}
