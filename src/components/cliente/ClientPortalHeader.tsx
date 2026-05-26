"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { clsx } from "clsx";

export function ClientPortalHeader({
  clientName,
  clientColor,
}: {
  clientName: string;
  clientColor: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/creatives")
      .then((r) => r.json())
      .then((items) => {
        const count = Array.isArray(items)
          ? items.filter((x: { status: string; sentBy: string }) => x.status === "pending" && x.sentBy === "manager").length
          : 0;
        setPendingCount(count);
      })
      .catch(() => {});
  }, []);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-3.5 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: clientColor }}
          >
            {clientName.charAt(0)}
          </div>
          <span className="font-semibold text-slate-900">{clientName}</span>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            href="/cliente"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition",
              pathname === "/cliente" || (!pathname.startsWith("/cliente/criativos") && !pathname.startsWith("/cliente/automacoes") && !pathname.startsWith("/cliente/crm"))
                ? "bg-slate-100 text-slate-900 font-medium"
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            Campanhas
          </Link>
          <Link
            href="/cliente/criativos"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
              pathname.startsWith("/cliente/criativos")
                ? "bg-purple-50 text-purple-700 font-medium"
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            🎨 Criativos
            {pendingCount > 0 && (
              <span className="rounded-full bg-yellow-400 text-slate-900 px-1.5 py-0.5 text-xs font-bold">
                {pendingCount}
              </span>
            )}
          </Link>
          <Link
            href="/cliente/automacoes"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
              pathname.startsWith("/cliente/automacoes")
                ? "bg-emerald-50 text-emerald-700 font-medium"
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            ⚡ Automações
          </Link>
          <Link
            href="/cliente/crm"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
              pathname.startsWith("/cliente/crm")
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            📋 CRM
          </Link>
          <Link
            href="/cliente/inbox"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
              pathname.startsWith("/cliente/inbox")
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            💬 Mensagens
          </Link>
        </nav>
      </div>
      <button
        onClick={logout}
        disabled={loggingOut}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Sair
      </button>
    </header>
  );
}
