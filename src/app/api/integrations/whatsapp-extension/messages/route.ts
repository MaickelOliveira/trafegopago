import { NextRequest, NextResponse } from "next/server";
import type { ExtensionDevice } from "@/lib/extension-devices";
import { getDeviceByToken } from "@/lib/extension-devices";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnelById } from "@/lib/funnels";
import { addMessage, getHistory } from "@/lib/conversations";
import { getConfig, getClientById, getAgentConfigForConnection } from "@/lib/clients";
import { getAdInfoById } from "@/lib/meta-api";
import { checkRateLimit } from "@/lib/rate-limit";
import { runGeminiAgent } from "@/lib/gemini-agent";
import { splitMessage } from "@/lib/uazapi";
import { queueReply } from "@/lib/extension-outbox";

type IncomingItem = {
  phone: string;
  chatId: string;
  isLid: boolean;
  realPhone: string | null;
  contactName: string | null;
  body: string;
  ts: number;
  adId: string | null;
  adSourceUrl: string | null;
  adTitle: string | null;
};

function deviceToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Gera e enfileira a resposta da IA (se ligada nesta conexão) — dispara em
 *  background, sem bloquear a resposta HTTP pro service worker (mesmo padrão
 *  de processMessages(...).catch(...) do webhook Evolution). A extensão não
 *  tem canal de envio direto: em vez de mandar a resposta na hora, enfileira
 *  em extension-outbox.ts pra content-script.ts buscar por polling e enviar
 *  via wa-js (ver main-world.ts). */
async function maybeGenerateAiReply(device: ExtensionDevice, item: IncomingItem, funnelId: string, historyKey: string) {
  // chatId ausente = extensão numa versão antiga (ainda não manda esse
  // campo) — sem ele não tem como endereçar uma resposta, nem tenta gerar.
  if (!item.chatId) return;
  const client = getClientById(device.clientId);
  if (!client) return;
  const agentCfg = getAgentConfigForConnection(client, device.id);
  if (!agentCfg?.enabled) return;
  if (getLeadByPhone(device.clientId, historyKey, funnelId)?.aiPaused) return;

  const history = getHistory(historyKey, device.clientId, device.id);
  const { text } = await runGeminiAgent(item.body, history, device.clientId, historyKey, device.id);
  if (!text) return;

  // A chamada à IA leva alguns segundos — reconfirma aiPaused depois (mesma
  // proteção contra corrida que o webhook Evolution já tem: um atendente
  // pode ter assumido a conversa manualmente enquanto a IA gerava a resposta).
  if (getLeadByPhone(device.clientId, historyKey, funnelId)?.aiPaused) return;

  const chunks = agentCfg.splitMessages ? splitMessage(text, agentCfg.maxMessageLength ?? 300) : [text];
  for (const chunk of chunks) {
    queueReply(device.id, item.chatId, item.phone, chunk);
  }
}

/** Chamada pelo service worker da extensão quando main-world.ts (via
 *  @wppconnect/wa-js) detecta uma mensagem nova de verdade — não mais uma
 *  prévia raspada do DOM. Reaproveita a MESMA função de upsert de lead que o
 *  webhook da Evolution API usa (src/lib/leads.ts), incluindo o mesmo
 *  reaproveitamento de lead entre funis quando já existe histórico nesta
 *  conexão, e o mesmo enriquecimento de campanha via Graph API quando a
 *  mensagem carrega contexto de anúncio (CTWa). */
export async function POST(req: NextRequest) {
  const token = deviceToken(req);
  if (!token) return NextResponse.json({ error: "Token ausente" }, { status: 401 });

  const device = getDeviceByToken(token);
  if (!device || device.status === "revoked") {
    return NextResponse.json({ error: "Dispositivo não autorizado" }, { status: 401 });
  }

  // Tráfego normal (não é alvo de força bruta como /claim) — limite generoso
  // só pra conter um loop com defeito na extensão, não pro uso normal.
  if (!checkRateLimit(`messages:${device.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { items?: IncomingItem[] } | null;
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "items obrigatório" }, { status: 400 });
  }

  console.log(`[ext-messages] device=${device.id} clientId=${device.clientId} funnelId=${device.funnelId ?? "null"} items=${body.items.length}`);

  // Sem funil vinculado ainda (o gestor vincula depois de conectar — ver
  // /api/integrations/whatsapp-extension/link), ignora silenciosamente.
  // Mesmo comportamento do webhook Evolution pra sessão sem funil: nunca
  // grava lead com um funnelId inválido/inexistente.
  if (!device.funnelId) {
    console.log(`[ext-messages] device=${device.id} ignorado — sem funil vinculado`);
    return NextResponse.json({ ok: true, processed: 0, skipped: body.items.length, reason: "no_funnel_linked" });
  }

  const funnel = getFunnelById(device.funnelId);
  if (!funnel) {
    console.log(`[ext-messages] device=${device.id} ignorado — funnelId=${device.funnelId} não existe mais`);
    return NextResponse.json({ ok: true, processed: 0, skipped: body.items.length, reason: "funnel_not_found" });
  }
  const defaultFunnelId = funnel.id;
  const clientId = device.clientId;
  const entradaColumnId = funnel.columns?.[0]?.id ?? "entrada";
  const cfg = getConfig();

  let processed = 0;
  let skipped = 0;

  for (const item of body.items.slice(0, 50)) {
    if (!item.phone || !item.body) {
      console.log(`[ext-messages] item pulado — phone=${item.phone || "ausente"} body=${item.body ? "presente" : "ausente"}`);
      skipped++;
      continue;
    }

    // Chave de identidade/histórico: usa o telefone real quando resolvido
    // (LID puro nunca bate com a conversa salva pelas outras integrações —
    // o resto da plataforma, ex: LeadModal.tsx/KanbanBoard.tsx, já lê
    // histórico e link do WhatsApp preferindo lead.realPhone sobre lead.phone).
    const historyKey = item.realPhone ?? item.phone;

    // Reaproveita lead existente do mesmo telefone em outro funil quando já
    // existe histórico nesta MESMA conexão (mesmo padrão do webhook Evolution)
    // — evita duplicar o lead de alguém que já conversou por outro canal.
    const leadInDefaultFunnel = getLeadByPhone(clientId, historyKey, defaultFunnelId);
    const leadElsewhere = leadInDefaultFunnel ? null : getLeadByPhone(clientId, historyKey);
    const hasHistoryOnThisConn = !!leadElsewhere && getHistory(historyKey, clientId, device.id).length > 0;
    const existingLead = leadInDefaultFunnel ?? (hasHistoryOnThisConn ? leadElsewhere : null);
    const isNew = !existingLead;
    const funnelId = existingLead?.funnelId ?? defaultFunnelId;

    // ── Contexto de anúncio (CTWa) — só presente quando a mensagem veio de
    // um clique em anúncio Meta, capturado por main-world.ts via wa-js. ──
    const alreadyAttributed = !!item.adId && existingLead?.adId === item.adId && !!existingLead?.campaignId;
    let adInfo: Awaited<ReturnType<typeof getAdInfoById>> = null;
    if (item.adId && !alreadyAttributed && cfg.metaToken) {
      adInfo = await getAdInfoById(item.adId, cfg.metaToken).catch(() => null);
    }
    const adFields = adInfo
      ? {
          adPlatform: "meta" as const,
          adId: adInfo.adId,
          adName: adInfo.adName,
          adSetId: adInfo.adSetId,
          adSetName: adInfo.adSetName,
          campaignId: adInfo.campaignId,
          campaignName: adInfo.campaignName,
          adSourceUrl: item.adSourceUrl ?? null,
        }
      : alreadyAttributed
      ? {}
      : item.adId || item.adTitle || item.adSourceUrl
      ? {
          adPlatform: "meta" as const,
          adId: item.adId ?? null,
          adName: null,
          adSetId: null,
          adSetName: null,
          campaignId: null,
          campaignName: item.adTitle ?? null,
          adSourceUrl: item.adSourceUrl ?? null,
        }
      : {};

    upsertLeadByPhone(clientId, historyKey, {
      clientId,
      funnelId,
      source: "whatsapp",
      ...(item.contactName ? { name: item.contactName } : {}),
      ...(isNew ? { status: entradaColumnId } : {}),
      ...(item.isLid ? { isLid: true } : {}),
      ...(item.realPhone ? { realPhone: item.realPhone } : {}),
      ...adFields,
    });

    addMessage(
      historyKey,
      { role: "user", content: item.body, ts: item.ts },
      clientId,
      { connId: device.id, contactName: item.contactName ?? undefined }
    );

    console.log(`[ext-messages] lead ${isNew ? "criado" : "atualizado"} phone=${historyKey} funnelId=${funnelId}`);

    maybeGenerateAiReply(device, item, funnelId, historyKey).catch((e) => {
      console.error("[whatsapp-extension/messages] erro ao gerar resposta da IA:", e);
    });

    processed++;
  }

  return NextResponse.json({ ok: true, processed, skipped });
}
