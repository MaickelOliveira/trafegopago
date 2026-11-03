"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Bot, ChevronRight, CircleHelp, Layers3, MessageSquare, Plus, Search, Settings2, Users } from "lucide-react";

export type HubClient = { id: string; name: string; email: string; color: string; logoUrl?: string; adAccounts: { id: string; name: string; platform: string }[]; enabledSystems?: string[]; funnelCount: number; channelCount: number; activeAgents: number };
export function ClientsHub({ clients }: { clients: HubClient[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = clients.filter(client => `${client.name} ${client.email}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")) && (filter === "all" || filter === "ai" && client.activeAgents > 0 || filter === "setup" && (!client.funnelCount || !client.channelCount)));
  const total = (key: "funnelCount" | "channelCount" | "activeAgents") => clients.reduce((sum, client) => sum + client[key], 0);
  return <div className="nexo-workspace">
    <div className="nexo-page-top"><span className="nexo-eyebrow">NEXO <span className="nexo-path-divider">/</span> OPERAÇÃO</span><span className="nexo-version">TRÁFEGO · IA · RELACIONAMENTO</span></div>
    <header className="nexo-page-heading"><div><span className="nexo-heading-label">SUA CENTRAL DE GESTÃO</span><h1>Clientes<span className="nexo-title-dot">.</span></h1><p>Cada negócio, suas conexões e o próximo passo.</p></div><Link className="nexo-primary" href="/gestor/clientes/novo"><Plus size={17} /> Novo cliente</Link></header>
    <section className="nexo-stats" aria-label="Resumo da plataforma">{[
      { label: "CLIENTES", value: clients.length, Icon: Users, detail: "Negócios na sua operação" },
      { label: "FUNIS", value: total("funnelCount"), Icon: Layers3, detail: "Jornadas de atendimento" },
      { label: "CANAIS CADASTRADOS", value: total("channelCount"), Icon: MessageSquare, detail: "Números vinculados aos funis" },
      { label: "AGENTES HABILITADOS", value: total("activeAgents"), Icon: Bot, detail: "Inteligência artificial ativada" },
    ].map(({ label, value, Icon, detail }) => <div key={label} className="nexo-stat"><div><span>{label}</span><Icon size={17} /></div><strong>{String(value).padStart(2, "0")}</strong><small>{detail}</small></div>)}</section>
    <section className="nexo-directory" aria-labelledby="directory-heading"><div className="nexo-directory-top"><div><h2 id="directory-heading">Seus clientes <span>{clients.length}</span></h2><p>Escolha uma empresa para configurar ou abrir sua operação.</p></div><label className="nexo-search"><Search size={17} /><span className="sr-only">Buscar cliente</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome ou e-mail" /></label></div>
      <div className="nexo-filter-row" aria-label="Filtrar clientes">{[{ id: "all", label: "Todos os clientes" }, { id: "ai", label: "Com IA habilitada" }, { id: "setup", label: "Configuração pendente" }].map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      <div className="nexo-client-list"><div className="nexo-client-list-labels"><span>CLIENTE</span><span>ESTRUTURA</span><span>ATENDIMENTO</span><span>AÇÕES</span></div>{visible.map(client => <article className="nexo-client-row" key={client.id}>
        <div className="nexo-client-identity"><span className="nexo-avatar" style={{ backgroundColor: client.color || "#263d37" }}>{client.name.slice(0, 2).toUpperCase()}</span><div><h3>{client.name}</h3><p>{client.email}</p></div></div>
        <div className="nexo-client-structure"><span>{client.funnelCount} {client.funnelCount === 1 ? "funil" : "funis"}</span><small>{client.channelCount} canais · {client.adAccounts.length} contas de anúncio</small></div>
        <div className="nexo-client-status"><span className={client.activeAgents ? "nexo-status active" : "nexo-status"}><span />{client.activeAgents ? "IA habilitada" : "IA desativada"}</span><small>CRM e campanhas</small></div>
        <div className="nexo-row-actions"><Link className="nexo-configure-link" href={`/gestor/${client.id}/configuracoes`}><Settings2 size={15} /><span>Configurar</span></Link><Link className="nexo-open-link" href={`/gestor/${client.id}/crm`} aria-label={`Abrir operação de ${client.name}`}><ArrowUpRight size={18} /></Link></div>
      </article>)}{!visible.length && <div className="nexo-empty"><Search size={28} /><h3>{clients.length ? "Nenhum cliente encontrado" : "Seu primeiro cliente começa aqui"}</h3><p>{clients.length ? "Tente outro nome ou limpe os filtros." : "Cadastre o negócio para organizar as contas e o atendimento."}</p>{clients.length ? <button onClick={() => { setSearch(""); setFilter("all"); }}>Limpar filtros</button> : <Link href="/gestor/clientes/novo">Cadastrar cliente <ChevronRight size={14} /></Link>}</div>}</div>
    </section>
    <div className="nexo-helper-strip"><span className="nexo-helper-icon"><CircleHelp size={18} /></span><p><strong>Onde configurar um cliente?</strong> Use “Configurar” na linha do negócio. Dados, metas e acessos ficam juntos.</p><ArrowDownLeft size={20} /></div>
    <footer className="nexo-workspace-footer"><span>NEXO — TRÁFEGO DE PERFORMANCE</span><span>Conexões que movem negócios.</span></footer>
  </div>;
}
