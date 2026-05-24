"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState, useEffect } from "react";

type AdAccount = { id: string; name: string; platform: string };
type Client = {
  id: string;
  name: string;
  email: string;
  color: string;
  cplTarget: number;
  adAccounts: AdAccount[];
};

export function GestorSidebar({ clients }: { clients: Client[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Detecta se está dentro de um cliente específico
  const clientMatch = pathname.match(/^\/gestor\/([^/]+)/);
  const activeClientId = clientMatch?.[1];
  const staticRoutes = ["configuracoes", "crm", "financeiro", "social", "whatsapp"];
  const isInsideClient = !!activeClientId && !staticRoutes.includes(activeClientId);
  const activeClient = isInsideClient ? clients.find((c) => c.id === activeClientId) : null;

  const criativosActive  = pathname.startsWith(`/gestor/${activeClientId}/criativos`);
  const automacoesActive = pathname.startsWith(`/gestor/${activeClientId}/automacoes`);
  const dashboardActive  = pathname.startsWith(`/gestor/${activeClientId}/dashboard`);
  const campanhasActive  = isInsideClient && !criativosActive && !automacoesActive && !dashboardActive;

  // Busca pendentes só do cliente ativo
  useEffect(() => {
    if (!activeClientId) { setPendingCount(0); return; }
    fetch(`/api/creatives?clientId=${activeClientId}`)
      .then((r) => r.json())
      .then((items) => {
        const count = Array.isArray(items)
          ? items.filter((x: { status: string; sentBy: string }) =>
              x.status === "pending" && x.sentBy === "client"
            ).length
          : 0;
        setPendingCount(count);
      })
      .catch(() => setPendingCount(0));
  }, [activeClientId]);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-200 bg-white sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <span className="font-semibold text-slate-900">TráfegoPago</span>
      </div>

      {/* ── MODO CLIENTE: dentro de /gestor/[clientId] ── */}
      {isInsideClient && activeClient ? (
        <>
          {/* Voltar */}
          <div className="px-3 pt-3 pb-2">
            <Link
              href="/gestor"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Todos os clientes
            </Link>
          </div>

          {/* Header do cliente */}
          <div className="px-5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: activeClient.color }}
              >
                {activeClient.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 truncate text-sm">{activeClient.name}</p>
                <p className="text-xs text-slate-400">CPL alvo: R$ {activeClient.cplTarget}</p>
              </div>
            </div>
          </div>

          {/* Nav do cliente */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <nav className="space-y-0.5">
              <Link
                href={`/gestor/${activeClient.id}`}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  campanhasActive
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Campanhas
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/crm`}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/crm`)
                    ? "bg-violet-50 text-violet-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">🎯</span>
                CRM
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/dashboard`}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  dashboardActive
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">📊</span>
                Dashboard
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/criativos`}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  criativosActive
                    ? "bg-purple-50 text-purple-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">🎨</span>
                Criativos
                {pendingCount > 0 && (
                  <span className="ml-auto rounded-full bg-yellow-400 text-slate-900 px-1.5 py-0.5 text-xs font-bold">
                    {pendingCount}
                  </span>
                )}
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/automacoes`}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  automacoesActive
                    ? "bg-emerald-50 text-emerald-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">⚡</span>
                Automações
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/agente`}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/agente`)
                    ? "bg-violet-50 text-violet-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">🤖</span>
                Agente IA
              </Link>
            </nav>
          </div>
        </>
      ) : (
        /* ── MODO OVERVIEW ── */
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <nav className="space-y-0.5">
              <Link
                href="/gestor"
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname === "/gestor"
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                </svg>
                Visão geral
              </Link>
              <Link
                href="/gestor/social"
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/social")
                    ? "bg-pink-50 text-pink-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">🎨</span>
                Social Media
              </Link>

              <Link
                href="/gestor/crm"
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/crm")
                    ? "bg-violet-50 text-violet-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">🎯</span>
                CRM
              </Link>
              <Link
                href="/gestor/whatsapp"
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/whatsapp")
                    ? "bg-green-50 text-green-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">📱</span>
                WhatsApp
              </Link>
              <Link
                href="/gestor/financeiro"
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/financeiro")
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base leading-none">💰</span>
                Financeiro
              </Link>
              {pathname.startsWith("/gestor/financeiro") && (
                <div className="ml-4 border-l border-slate-200 pl-3 space-y-0.5">
                  {[
                    { href: "/gestor/financeiro",          label: "Visão geral" },
                    { href: "/gestor/financeiro/receitas", label: "Receitas" },
                    { href: "/gestor/financeiro/despesas", label: "Despesas" },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={clsx(
                        "block rounded-lg px-3 py-1.5 text-sm transition",
                        pathname === item.href
                          ? "bg-emerald-100 text-emerald-800 font-medium"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </nav>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="border-t border-slate-100 p-3 space-y-0.5">
        <Link
          href="/gestor/configuracoes"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configurações
        </Link>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sair
        </button>
      </div>
    </aside>
  );
}
