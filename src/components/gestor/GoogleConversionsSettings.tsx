"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { GoogleConversionSettings } from "@/lib/google-conversion-plan";

type Setup = { authorized: boolean; settings: GoogleConversionSettings | null; accounts: {id:string;name:string}[]; funnels: {id:string;name:string;columns:{id:string;label:string}[]}[]; counts:{status:string;count:number}[]; recent:{id:string;kind:string;status:string;reason:string|null;warnings:boolean;occurred_at:string}[] };
const labels:Record<string,string> = {pending:"Na fila",processing:"Em envio",submitted:"Aguardando processamento",succeeded:"Processado pelo Google",failed:"Precisa de atenção",skipped:"Não enviado",cancelled:"Cancelado"};
const reasons:Record<string,string> = {missing_click:"Sem identificação de clique do Google.",invalid_click:"Identificação do anúncio inválida.",other_source:"Contato identificado como Meta.",settings_changed:"Configuração alterada antes do envio.",google_connection:"Revise a autorização de conversões e a API no projeto Nexo.",rate_limited:"Aguardando o limite de consultas ser liberado.",google_rejected:"O Google recusou o envio.",delivery_unconfirmed:"Confirmação do envio pendente.",google_processing_failed:"O Google não concluiu o processamento.",diagnostics_unavailable:"Aguardando a consulta do processamento."};
export function GoogleConversionsSettings({clientId,result}:{clientId:string;result?:string}) {
  const [data,setData]=useState<Setup|null>(null);
  const [form,setForm]=useState({accountId:"",funnelId:"",qualifiedColumnId:"",saleColumnId:"",qualifiedActionId:"",saleActionId:""});
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState<{error:boolean;text:string;place?:"top"|"actions"}|null>(null);
  const endpoint=`/api/gestor/clients/${encodeURIComponent(clientId)}/google-conversions`;
  const load=useCallback(async()=>{
    const response=await fetch(endpoint);const next=await response.json();
    if(!response.ok)throw Error(next.error||"Não foi possível consultar as conversões.");
    const setup=next as Setup;setData(setup);
    setForm(current=>setup.settings?{accountId:setup.settings.accountId,funnelId:setup.settings.funnelId,qualifiedColumnId:setup.settings.qualifiedColumnId,saleColumnId:setup.settings.saleColumnId,qualifiedActionId:setup.settings.qualifiedActionId,saleActionId:setup.settings.saleActionId}:{...current,accountId:current.accountId||setup.accounts[0]?.id.replace(/\D/g,"")||"",funnelId:current.funnelId||setup.funnels[0]?.id||""});
  },[endpoint]);
  useEffect(()=>{let active=true;load().catch(()=>{if(active)setNotice({error:true,text:"Não foi possível consultar as conversões. Tente atualizar."});});return()=>{active=false;};},[load]);
  const funnel=data?.funnels.find(item=>item.id===form.funnelId);
  async function action(name:"prepare"|"activate"|"disable"|"refresh") {
    setBusy(name);setNotice(null);
    try {
      if(name==="refresh"){await load();return;}
      const response=await fetch(endpoint,{method:name==="prepare"?"POST":"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(name==="disable"?{enabled:false}:{...form,enabled:true})});
      const body=await response.json();if(!response.ok)throw Error(body.error||"Não foi possível concluir a configuração.");
      if(name==="prepare") {setForm(current=>({...current,qualifiedActionId:body.qualifiedActionId,saleActionId:body.saleActionId}));setNotice({error:false,place:"actions",text:"Ações de contato qualificado e venda preparadas no Google. Escolha as etapas e ative o envio."});}
      else {await load();setNotice({error:false,place:"actions",text:name==="disable"?"Novos envios de conversões pausados.":"Envio ativado para as próximas entradas nas etapas escolhidas."});}
    }catch(error){setNotice({error:true,place:name==="refresh"?"top":"actions",text:error instanceof Error?error.message:"Não foi possível concluir a configuração."});}finally{setBusy("");}
  }
  const feedback=notice&&<div role={notice.error?"alert":"status"} className={`nexo-feedback ${notice.error?"error":"success"}`}>{!notice.error&&<Check size={17}/>} {notice.text}</div>;
  return <div className="nexo-google-conversions">
    <div className="nexo-tracking-status" data-ready={!!data?.settings?.enabled&&!!data?.authorized}><ShieldCheck size={22}/><div><strong>{data?.settings?.enabled?data.authorized?"Regras de envio de conversões ativadas":"Regras salvas. Autorização de conversões pendente.":"Conversões do CRM para o Google Ads"}</strong><p>Informe quando um contato se qualifica ou uma venda é concluída. A ligação com o anúncio usa a identificação de clique capturada no contato.</p></div></div>
    {result&&<div className={`nexo-feedback ${result==="connected"?"success":"error"}`} role={result==="connected"?"status":"alert"}>{result==="connected"?"Autorização de conversões salva. Prepare as ações e ative as etapas abaixo.":result==="setup"?"Salve o aplicativo Google da Nexo em Plataforma e conexões antes de conectar.":"A autorização de conversões não foi concluída. Tente conectar novamente."}</div>}
    {notice?.place!=="actions"&&feedback}
    {!data?<button type="button" className="nexo-secondary" onClick={()=>void action("refresh")}>Atualizar configuração</button>:<>
      <div className="nexo-conversion-actions"><a className="nexo-secondary" href={`/api/gestor/google-conversions/connect?clientId=${encodeURIComponent(clientId)}`}>{data.authorized?"Renovar autorização de conversões":"Autorizar conversões no Google"}<ArrowUpRight size={15}/></a><button type="button" className="nexo-secondary" disabled={!!busy} onClick={()=>void action("refresh")}><RefreshCw size={15}/>Atualizar situação</button></div>
      <p className="nexo-conversion-help">Esta autorização é separada da consulta de anúncios e do backup. O envio usa o identificador do clique, a data, a ação e o valor registrado; nomes, telefones, e-mails e conversas não são incluídos.</p>
      {!data.accounts.length?<div className="nexo-inline-empty"><p>Vincule uma conta Google Ads na seção Contas de anúncio.</p></div>:<>
        <div className="nexo-form-grid"><label className="nexo-field"><span>Conta Google Ads</span><select value={form.accountId} onChange={event=>setForm(current=>({...current,accountId:event.target.value,qualifiedActionId:"",saleActionId:""}))}>{data.accounts.map(account=><option key={account.id} value={account.id.replace(/\D/g,"")}>{account.name} · {account.id}</option>)}</select></label><label className="nexo-field"><span>Funil que envia as conversões</span><select value={form.funnelId} onChange={event=>setForm(current=>({...current,funnelId:event.target.value,qualifiedColumnId:"",saleColumnId:""}))}><option value="">Escolha o funil</option>{data.funnels.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <div className="nexo-form-grid">{([['qualifiedColumnId','Contato qualificado'],['saleColumnId','Venda concluída']] as const).map(([key,label])=><label className="nexo-field" key={key}><span>{label}</span><select value={form[key]} onChange={event=>setForm(current=>({...current,[key]:event.target.value}))}><option value="">Escolha a etapa</option>{funnel?.columns.map(column=><option key={column.id} value={column.id}>{column.label}</option>)}</select></label>)}</div>
        <div className="nexo-conversion-rule"><strong>Ações separadas no Google</strong><p>Nexo — Contato qualificado (CRM)<br/>Nexo — Venda (CRM)</p><p>A preparação cria apenas as ações que faltam e mantém as campanhas e os lances atuais. A venda usa o valor do contato no momento da mudança; sem valor informado, registra zero.</p></div>
        {notice?.place==="actions"&&feedback}
        <div className="nexo-conversion-actions"><button type="button" className="nexo-secondary" disabled={!!busy||!form.accountId} onClick={()=>void action("prepare")}>{busy==="prepare"?<Loader2 size={16} className="animate-spin"/>:null}Preparar ações no Google</button><button type="button" className="nexo-primary" disabled={!!busy||!data.authorized||!form.qualifiedActionId||!form.saleActionId||!form.qualifiedColumnId||!form.saleColumnId} onClick={()=>void action("activate")}>{busy==="activate"?<Loader2 size={16} className="animate-spin"/>:null}{data.settings?.enabled?"Salvar novas regras":"Ativar envio das próximas conversões"}</button>{data.settings?.enabled&&<button type="button" className="nexo-secondary" disabled={!!busy} onClick={()=>void action("disable")}>Pausar novos envios</button>}</div>
        <p className="nexo-conversion-help">Cada contato gera no máximo uma qualificação e uma venda. O histórico anterior à ativação é preservado. Contatos sem identificação válida do anúncio ficam registrados como não enviados. As ações são de acompanhamento; mudar sua participação nos lances exige ajuste próprio no Google Ads.</p>
      </>}
      <div className="nexo-conversion-summary">{[{key:'pending',label:'Na fila'},{key:'processing',label:'Em envio'},{key:'submitted',label:'Aguardando Google'},{key:'succeeded',label:'Processados'},{key:'skipped',label:'Não enviados'},{key:'failed',label:'Precisam de atenção'}].map(item=><article key={item.key}><span>{item.label}</span><strong>{data.counts.find(count=>count.status===item.key)?.count||0}</strong></article>)}</div>
      <div className="nexo-conversion-history"><h3>Últimas conversões</h3><p>Recebimento e processamento são etapas diferentes. A consulta do processamento começa após 30 minutos; a atribuição e os relatórios do Google podem levar mais tempo.</p>{data.recent.length?data.recent.map(item=><article key={item.id}><div><strong>{item.kind==="sale"?"Venda":"Contato qualificado"}</strong><span>{new Date(item.occurred_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · Brasília</span></div><div><strong>{labels[item.status]||"Aguardando"}</strong><span>{item.reason?reasons[item.reason]||"Confira a conexão e a identificação do anúncio.":item.warnings?"Processado com aviso do Google.":""}</span></div></article>):<div className="nexo-inline-empty"><p>As novas conversões aparecerão aqui depois da ativação.</p></div>}</div>
    </>}
  </div>;
}
