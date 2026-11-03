"use client";
import { useHydrated } from "@/lib/use-hydrated";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, BarChart3, Bot, CheckSquare, ChevronDown, Code2, DollarSign, FileText, Home, Layers3, LayoutGrid, Link2, LogOut, Menu, MessageSquare, Palette, Phone, Plus, RefreshCw, Send, Settings2, Share2, ShieldCheck, Smartphone, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
type Client = { id: string; name: string; email: string; color: string; logoUrl?: string; cplTarget: number; adAccounts: { id: string; name: string; platform: string }[]; enabledSystems?: string[] };
type Item = { href: string; label: string; Icon: LucideIcon; exact?: boolean };
export function GestorSidebar({ clients }: { clients: Client[] }) {
  const hydrated = useHydrated();
  const pathname = usePathname(); const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const main = document.getElementById("main-content");
    const previousInert = main?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    const trigger = document.activeElement as HTMLElement | null;
    if (main) main.inert = true;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(document.querySelectorAll<HTMLElement>("#nexo-main-nav a, #nexo-main-nav button, #nexo-main-nav summary, .nexo-mobile-bar button")).filter(element => element.getClientRects().length > 0 && !element.hasAttribute("disabled"));
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown",close);
    return () => { if (main) main.inert = previousInert; document.body.style.overflow = previousOverflow; document.removeEventListener("keydown",close); trigger?.focus(); };
  },[open]);
  const [loggingOut, setLoggingOut] = useState(false);
  const client = clients.find(item => pathname === `/gestor/${item.id}` || pathname.startsWith(`/gestor/${item.id}/`));
  const base = client ? `/gestor/${client.id}` : "";
  function item({ href, label, Icon, exact }: Item) {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`nexo-nav-item ${active ? "is-active" : ""}`} onClick={() => setOpen(false)}><Icon size={18} strokeWidth={1.7} /><span>{label}</span>{active && <span className="nexo-nav-marker" />}</Link>;
  }
  const section = (label: string, items: Item[]) => <div className="nexo-nav-section"><p>{label}</p>{items.map(item)}</div>;
  return <><div className="nexo-mobile-bar"><Link href="/gestor" className="nexo-wordmark"><span>×</span> nexo<span className="nexo-wordmark-period">.</span></Link><button disabled={!hydrated} aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} aria-controls="nexo-main-nav" onClick={() => setOpen(value => !value)}>{open ? <X /> : <Menu />}</button></div>{open && <button className="nexo-nav-backdrop" aria-label="Fechar navegação" onClick={() => setOpen(false)} />}
    <aside id="nexo-main-nav" className={`nexo-sidebar ${open ? "is-open" : ""}`} aria-label="Navegação principal"><Link href="/gestor" className="nexo-wordmark" onClick={() => setOpen(false)}><span>×</span> nexo<span className="nexo-wordmark-period">.</span></Link><div className="nexo-sidebar-caption">GESTÃO EM MOVIMENTO</div>
      <div className="nexo-workspace-switch"><span className="nexo-workspace-icon"><Layers3 size={17} /></span><div><strong>Seu espaço</strong><small>Central Nexo</small></div><ChevronDown size={14} /></div>
      <nav>{client ? <><Link href="/gestor/clientes" className="nexo-back-clients" onClick={() => setOpen(false)}><ArrowLeft size={14} /> Todos os clientes</Link><div className="nexo-active-client"><span style={{ backgroundColor: client.color }}>{client.name.slice(0, 2).toUpperCase()}</span><div><strong>{client.name}</strong><small>Operação do cliente</small></div></div><Link href={`${base}/configuracoes`} className="nexo-client-config" onClick={() => setOpen(false)}><Settings2 size={16} /> Configurar cliente <ArrowUpRight size={14} /></Link>
        {section("ATENDIMENTO", [{ href: `${base}/inbox`, label: "Mensagens", Icon: MessageSquare }, { href: `${base}/crm`, label: "CRM e contatos", Icon: Users }, { href: `${base}/agente`, label: "Agente de IA", Icon: Bot }, { href: `${base}/crm-automacoes`, label: "Automações", Icon: RefreshCw }, { href: `${base}/waba`, label: "Disparos", Icon: Send }])}
        {section("RESULTADOS", [{ href: base, label: "Campanhas", Icon: BarChart3, exact: true }, { href: `${base}/dashboard`, label: "Indicadores", Icon: LayoutGrid }, { href: `${base}/criativos`, label: "Criativos", Icon: Palette }])}
        {section("ORGANIZAÇÃO", [{ href: `${base}/briefings`, label: "Briefings", Icon: FileText }, { href: `${base}/checklist`, label: "Checklist", Icon: CheckSquare }])}
        <details className="nexo-nav-tools"><summary>Ferramentas de conexão <ChevronDown size={13} /></summary>{[{ href: `${base}/webhooks`, label: "Formulários e webhooks", Icon: Link2 }, { href: `${base}/utm-builder`, label: "Links de campanha", Icon: Code2 }, { href: `${base}/wa-links`, label: "Rastreio WhatsApp", Icon: Phone }].map(item)}</details>
      </> : <>{section("OPERAÇÃO", [{ href: "/gestor", label: "Visão geral", Icon: LayoutGrid, exact: true }, { href: "/gestor/clientes", label: "Clientes", Icon: Users }, { href: "/gestor/crm", label: "CRM e contatos", Icon: Layers3 }, { href: "/gestor/whatsapp", label: "WhatsApp", Icon: MessageSquare }])}{section("GESTÃO", [{ href: "/gestor/social", label: "Social e conteúdo", Icon: Share2 }, { href: "/gestor/financeiro", label: "Financeiro", Icon: DollarSign }, { href: "/gestor/checklist", label: "Checklist", Icon: CheckSquare }])}<Link href="/gestor/clientes/novo" className="nexo-sidebar-new" onClick={() => setOpen(false)}><Plus size={16} /> Adicionar cliente</Link></>}
      </nav><div className="nexo-sidebar-footer">{item({ href: "/gestor/configuracoes", label: "Plataforma e conexões", Icon: Settings2 })}<div className="nexo-sidebar-footnote"><ShieldCheck size={13} /><span>Seu ambiente de gestão</span></div><button disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { const result = await fetch("/api/auth/logout", { method: "POST" }); if (!result.ok) throw Error(); router.push("/login"); } catch { setLoggingOut(false); } }}><LogOut size={16} />{loggingOut ? "Saindo…" : "Sair da conta"}</button></div>
    </aside></>;
}
