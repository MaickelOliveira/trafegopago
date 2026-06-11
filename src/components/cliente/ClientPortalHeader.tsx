"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { clsx } from "clsx";
import type { EmployeePermissions } from "@/lib/employees";

export function ClientPortalHeader({
  clientName,
  clientColor,
  isEmployee = false,
  permissions,
  clientLogoUrl,
  employeeName,
}: {
  clientName: string;
  clientColor: string;
  isEmployee?: boolean;
  permissions?: EmployeePermissions;
  clientLogoUrl?: string | null;
  employeeName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const canViewCreatives = !isEmployee || (permissions?.canViewCreatives ?? false);
  const canViewAutomations = !isEmployee || (permissions?.canViewAutomations ?? false);
  const canViewAgentIa = !isEmployee || (permissions?.canViewAgentIa ?? false);

  useEffect(() => {
    if (!canViewCreatives) return;
    fetch("/api/creatives")
      .then((r) => r.json())
      .then((items) => {
        const count = Array.isArray(items)
          ? items.filter((x: { status: string; sentBy: string }) => x.status === "pending" && x.sentBy === "manager").length
          : 0;
        setPendingCount(count);
      })
      .catch(() => {});
  }, [canViewCreatives]);

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
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white overflow-hidden"
            style={!isEmployee && clientLogoUrl ? undefined : { backgroundColor: clientColor }}
          >
            {!isEmployee && clientLogoUrl ? (
              <Image src={clientLogoUrl} alt="Logo" fill className="object-cover" />
            ) : (
              clientName.charAt(0)
            )}
          </div>
          <span className="font-semibold text-slate-900">
            {isEmployee && employeeName ? employeeName : clientName}
          </span>
          {isEmployee && (
            <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-medium px-2 py-0.5">
              Funcionário
            </span>
          )}
        </div>
        <nav className="flex items-center gap-1">
          {/* Dashboard — somente cliente dono (não funcionário) */}
          {!isEmployee && (
          <Link
            href="/cliente"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
              pathname === "/cliente"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            📊 Dashboard
          </Link>
          )}

          {/* CRM — sempre visível */}
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

          {/* Criativos — visível se canViewCreatives */}
          {canViewCreatives && (
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
          )}

          {/* Automações — visível se canViewAutomations */}
          {canViewAutomations && (
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
          )}

          {/* Mensagens — sempre visível */}
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

          {/* Agente de IA — visível se canViewAgentIa */}
          {canViewAgentIa && (
            <Link
              href="/cliente/agente-ia"
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
                pathname.startsWith("/cliente/agente-ia")
                  ? "bg-violet-50 text-violet-700 font-medium"
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              🤖 Agente de IA
            </Link>
          )}

          {/* Colaboradores — somente cliente dono */}
          {!isEmployee && (
            <Link
              href="/cliente/funcionarios"
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
                pathname.startsWith("/cliente/funcionarios")
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              👥 Colaboradores
            </Link>
          )}

          {/* Configurações — somente clientes donos */}
          {!isEmployee && (
            <Link
              href="/cliente/configuracoes"
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5",
                pathname.startsWith("/cliente/configuracoes")
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              ⚙️ Configurações
            </Link>
          )}
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
