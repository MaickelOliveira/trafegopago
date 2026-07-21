"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState, useEffect } from "react";
import {
  Megaphone, Users, LayoutDashboard, Palette, Zap, Bot,
  FileText, MessageSquare, Send, Link2, Code2, Phone,
  RefreshCw, Settings, LogOut, LayoutGrid, Share2,
  Smartphone, DollarSign, ChevronLeft, Activity, CheckSquare, Home,
} from "lucide-react";

type AdAccount = { id: string; name: string; platform: string };
type Client = {
  id: string;
  name: string;
  email: string;
  color: string;
  logoUrl?: string;
  cplTarget: number;
  adAccounts: AdAccount[];
  enabledSystems?: string[];
};

const NEXO_GREEN = "#C4E91E";

// classes reutilizáveis
const NAV_INACTIVE = "text-slate-500 hover:bg-slate-50 hover:text-slate-800";
const NAV_ACTIVE   = "bg-[#C4E91E]/15 text-[#8aad00] font-semibold";

/** Retorna a chave única da rota ativa — garante que APENAS 1 item fique ativo */
function getActiveKey(pathname: string, clientId: string): string {
  if (pathname.startsWith(`/gestor/${clientId}/pousada`))        return "pousada";
  if (pathname.startsWith(`/gestor/${clientId}/crm-automacoes`)) return "crm-automacoes";
  if (pathname.startsWith(`/gestor/${clientId}/crm`))            return "crm";
  if (pathname.startsWith(`/gestor/${clientId}/dashboard`))      return "dashboard";
  if (pathname.startsWith(`/gestor/${clientId}/criativos`))      return "criativos";
  if (pathname.startsWith(`/gestor/${clientId}/automacoes`))     return "automacoes";
  if (pathname.startsWith(`/gestor/${clientId}/agente`))         return "agente";
  if (pathname.startsWith(`/gestor/${clientId}/monitoramento`))  return "monitoramento";
  if (pathname.startsWith(`/gestor/${clientId}/briefings`))      return "briefings";
  if (pathname.startsWith(`/gestor/${clientId}/checklist`))      return "checklist";
  if (pathname.startsWith(`/gestor/${clientId}/inbox`))          return "inbox";
  if (pathname.startsWith(`/gestor/${clientId}/waba`))           return "waba";
  if (pathname.startsWith(`/gestor/${clientId}/webhooks`))       return "webhooks";
  if (pathname.startsWith(`/gestor/${clientId}/utm-builder`))    return "utm-builder";
  if (pathname.startsWith(`/gestor/${clientId}/wa-links`))       return "wa-links";
  if (pathname === `/gestor/${clientId}`)                        return "campanhas";
  return "";
}

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

  // Chave única da rota ativa — garante apenas 1 item selecionado por vez
  const activeKey = isInsideClient && activeClientId ? getActiveKey(pathname, activeClientId) : "";

  const isActive = (key: string) => activeKey === key;

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

  const navItem = (key: string, href: string, Icon: React.ElementType, label: string, badge?: number) => (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
        isActive(key) ? NAV_ACTIVE : NAV_INACTIVE
      )}
    >
      <Icon className={clsx("h-[18px] w-[18px] shrink-0", isActive(key) ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-[#C4E91E] text-black px-1.5 py-0.5 text-xs font-bold leading-none">
          {badge}
        </span>
      )}
    </Link>
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-200 bg-white sticky top-0">

      {/* Logo */}
      <div style={{ height: "60px", overflow: "hidden", borderBottom: "1px solid #e2e8f0", position: "relative" }}>
        <img
          src="/nexo-logo.png"
          alt="Nexo"
          style={{
            position: "absolute",
            width: "90%",
            left: "5%",
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
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
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              Todos os clientes
            </Link>
          </div>

          {/* Header do cliente */}
          <div className="px-5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <span
                className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-black overflow-hidden"
                style={activeClient.logoUrl ? undefined : { backgroundColor: NEXO_GREEN }}
              >
                {activeClient.logoUrl ? (
                  <Image src={activeClient.logoUrl} alt={activeClient.name} fill className="object-cover" />
                ) : (
                  activeClient.name.charAt(0).toUpperCase()
                )}
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
              {navItem("campanhas",      `/gestor/${activeClient.id}`,                    Megaphone,    "Campanhas")}
              {navItem("crm",            `/gestor/${activeClient.id}/crm`,                Users,        "CRM")}
              {navItem("dashboard",      `/gestor/${activeClient.id}/dashboard`,           LayoutDashboard, "Dashboard")}
              {navItem("criativos",      `/gestor/${activeClient.id}/criativos`,           Palette,      "Criativos", pendingCount)}
              {navItem("automacoes",     `/gestor/${activeClient.id}/automacoes`,          Zap,          "Automações")}
              {navItem("agente",         `/gestor/${activeClient.id}/agente`,              Bot,          "Agente IA")}
              {navItem("monitoramento",  `/gestor/${activeClient.id}/monitoramento`,       Activity,     "Monitoramento")}
              {navItem("briefings",      `/gestor/${activeClient.id}/briefings`,           FileText,     "Briefings")}
              {navItem("checklist",      `/gestor/${activeClient.id}/checklist`,           CheckSquare,  "Checklist")}
              {navItem("inbox",          `/gestor/${activeClient.id}/inbox`,               MessageSquare,"Mensagens")}
              {navItem("waba",           `/gestor/${activeClient.id}/waba`,                Send,         "Disparos WA")}
              {navItem("webhooks",       `/gestor/${activeClient.id}/webhooks`,            Link2,        "Webhooks")}
              {navItem("utm-builder",    `/gestor/${activeClient.id}/utm-builder`,         Code2,        "UTM Builder")}
              {navItem("wa-links",       `/gestor/${activeClient.id}/wa-links`,            Phone,        "Rastreio WhatsApp")}
              {navItem("crm-automacoes", `/gestor/${activeClient.id}/crm-automacoes`,      RefreshCw,    "Automações CRM")}
              {activeClient.enabledSystems?.includes("pousada") &&
                navItem("pousada", `/gestor/${activeClient.id}/pousada`, Home, "Pousada")}
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
                className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  pathname === "/gestor" ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <LayoutGrid className={clsx("h-[18px] w-[18px] shrink-0", pathname === "/gestor" ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
                Visão geral
              </Link>
              <Link
                href="/gestor/social"
                className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  pathname.startsWith("/gestor/social") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <Share2 className={clsx("h-[18px] w-[18px] shrink-0", pathname.startsWith("/gestor/social") ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
                Social Media
              </Link>
              <Link
                href="/gestor/crm"
                className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  pathname.startsWith("/gestor/crm") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <Users className={clsx("h-[18px] w-[18px] shrink-0", pathname.startsWith("/gestor/crm") ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
                CRM
              </Link>
              <Link
                href="/gestor/whatsapp"
                className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  pathname.startsWith("/gestor/whatsapp") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <Smartphone className={clsx("h-[18px] w-[18px] shrink-0", pathname.startsWith("/gestor/whatsapp") ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
                WhatsApp
              </Link>
              <Link
                href="/gestor/financeiro"
                className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  pathname.startsWith("/gestor/financeiro") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <DollarSign className={clsx("h-[18px] w-[18px] shrink-0", pathname.startsWith("/gestor/financeiro") ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
                Financeiro
              </Link>
              <Link
                href="/gestor/checklist"
                className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  pathname.startsWith("/gestor/checklist") ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                <CheckSquare className={clsx("h-[18px] w-[18px] shrink-0", pathname.startsWith("/gestor/checklist") ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
                Checklist
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
          className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
            pathname.startsWith("/gestor/configuracoes") ? NAV_ACTIVE : NAV_INACTIVE)}
        >
          <Settings className={clsx("h-[18px] w-[18px] shrink-0", pathname.startsWith("/gestor/configuracoes") ? "text-[#8aad00]" : "text-slate-400")} strokeWidth={1.75} />
          Configurações
        </Link>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 transition"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0 text-slate-400" strokeWidth={1.75} />
          Sair
        </button>
      </div>
    </aside>
  );
}
