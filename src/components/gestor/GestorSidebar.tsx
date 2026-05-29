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

const NEXO_GREEN = "#C4E91E";

// classes reutilizáveis
const NAV_INACTIVE = "text-slate-600 hover:bg-slate-50 hover:text-slate-900";
const NAV_ACTIVE   = "bg-[#C4E91E]/10 text-[#C4E91E] font-medium";

export function GestorSidebar({ clients }: { clients: Client[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const clientMatch = pathname.match(/^\/gestor\/([^/]+)/);
  const activeClientId = clientMatch?.[1];
  const staticRoutes = ["configuracoes", "crm", "financeiro", "social", "whatsapp", "utm-builder", "wa-links"];
  const isInsideClient = !!activeClientId && !staticRoutes.includes(activeClientId);
  const activeClient = isInsideClient ? clients.find((c) => c.id === activeClientId) : null;

  const criativosActive   = pathname.startsWith(`/gestor/${activeClientId}/criativos`);
  const automacoesActive  = pathname.startsWith(`/gestor/${activeClientId}/automacoes`);
  const dashboardActive   = pathname.startsWith(`/gestor/${activeClientId}/dashboard`);
  const campanhasActive   = pathname === `/gestor/${activeClientId}`;

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
      <div className="flex items-center border-b border-slate-100 px-5 py-5">
        <img src="/nexo-logo.png" alt="Nexo" className="h-16 w-auto object-contain" />
      </div>

      {/* ── MODO CLIENTE ── */}
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
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-black"
                style={{ backgroundColor: NEXO_GREEN }}
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
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  campanhasActive ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Campanhas
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/crm`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/crm`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                CRM
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/dashboard`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  dashboardActive ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Dashboard
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/criativos`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  criativosActive ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Criativos
                {pendingCount > 0 && (
                  <span className="ml-auto rounded-full bg-[#C4E91E] text-black px-1.5 py-0.5 text-xs font-bold">
                    {pendingCount}
                  </span>
                )}
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/automacoes`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  automacoesActive ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Automações
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/agente`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/agente`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 001.357 2.059l.096.04A2.25 2.25 0 0117.25 13.5h.14c1.006 0 2.01-.26 2.91-.76L21 12M9.75 3.104A24.1 24.1 0 0012 3c.77 0 1.532.038 2.25.104M5 14.5L3.75 15.75M5 14.5l1.25 1.25m0 0l2.786 2.786a2.25 2.25 0 003.182 0l2.786-2.786m-8.754 0a2.25 2.25 0 000 3.182" />
                </svg>
                Agente IA
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/briefings`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/briefings`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                Briefings
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/inbox`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/inbox`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Mensagens
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/waba`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/waba`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Disparos WA
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/webhooks`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/webhooks`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Webhooks
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/utm-builder`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/utm-builder`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 7l3-3 3 3m0 0l3 3m-3-3v11M3 17l3 3 3-3m0 0V6m9 11h2a2 2 0 002-2V9a2 2 0 00-2-2h-2" />
                </svg>
                UTM Builder
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/wa-links`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/wa-links`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Rastreio WhatsApp
              </Link>

              <Link
                href={`/gestor/${activeClient.id}/crm-automacoes`}
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  pathname.startsWith(`/gestor/${activeClient.id}/crm-automacoes`) ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Automações CRM
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
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname === "/gestor" ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                </svg>
                Visão geral
              </Link>
              <Link
                href="/gestor/social"
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/social") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Social Media
              </Link>

              <Link
                href="/gestor/crm"
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/crm") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                CRM
              </Link>
              <Link
                href="/gestor/whatsapp"
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/whatsapp") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                WhatsApp
              </Link>
              <Link
                href="/gestor/financeiro"
                className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                  pathname.startsWith("/gestor/financeiro") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
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
                      className={clsx("block rounded-lg px-3 py-1.5 text-sm transition",
                        pathname === item.href ? NAV_ACTIVE : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")}
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
          className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
            pathname.startsWith("/gestor/configuracoes") ? NAV_ACTIVE : NAV_INACTIVE)}
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
