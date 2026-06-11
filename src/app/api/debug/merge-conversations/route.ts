import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { phoneVariants } from "@/lib/conversations";

export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string; ts: number; type?: string; mediaUrl?: string };
type Conversation = {
  messages: ChatMessage[];
  clientId: string | null;
  connId?: string | null;
  contactName?: string | null;
  lastActivity: number;
  unread?: boolean;
  aiPaused?: boolean;
};

const FILE = path.join(process.cwd(), "data", "conversations.json");
const MAX_MESSAGES = 200;

/** Extrai a parte do telefone de uma chave de conversations.json. */
function phonePartOf(key: string, clientId: string, conv: Conversation): string {
  let rest = key;
  if (rest.startsWith(`${clientId}:`)) rest = rest.slice(clientId.length + 1);
  if (conv.connId && rest.startsWith(`${conv.connId}:`)) rest = rest.slice(conv.connId.length + 1);
  return rest;
}

/**
 * Junta conversas duplicadas do mesmo lead (mesmo clientId, telefone em formatos
 * diferentes — ex: com e sem o "55") em uma única chave.
 * Sem ?apply=1 mostra apenas o plano (dry-run); com ?apply=1 executa de fato.
 */
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  const connId = req.nextUrl.searchParams.get("connId") || null;
  const apply = req.nextUrl.searchParams.get("apply") === "1";

  if (!phone || !clientId) {
    return NextResponse.json({ error: "Informe phone e clientId" }, { status: 400 });
  }

  const digits = phone.replace(/\D/g, "");
  const variants = new Set(phoneVariants(digits));

  if (!existsSync(FILE)) {
    return NextResponse.json({ error: "conversations.json não encontrado" }, { status: 404 });
  }
  const all: Record<string, Conversation> = JSON.parse(readFileSync(FILE, "utf-8"));

  // Encontra todas as chaves que correspondem a esse telefone (em qualquer variante),
  // pertencem ao clientId informado e (se connId informado) à mesma conexão ou sem conexão definida.
  const matches = Object.entries(all).filter(([key, conv]) => {
    if (conv.clientId && conv.clientId !== clientId && !key.startsWith(`${clientId}:`)) return false;
    if (connId && conv.connId && conv.connId !== connId) return false;
    const phonePart = phonePartOf(key, clientId, conv).replace(/\D/g, "");
    return variants.has(phonePart);
  });

  if (matches.length < 2) {
    return NextResponse.json({
      message: `Nada para juntar — encontrada(s) ${matches.length} conversa(s) para esse telefone.`,
      matches: matches.map(([key]) => key),
    });
  }

  // Escolhe a conversa "primária": mais mensagens; empate → tem contactName real; empate → atividade mais recente.
  const sorted = [...matches].sort(([, a], [, b]) => {
    if (b.messages.length !== a.messages.length) return b.messages.length - a.messages.length;
    const aName = a.contactName ? 1 : 0;
    const bName = b.contactName ? 1 : 0;
    if (bName !== aName) return bName - aName;
    return b.lastActivity - a.lastActivity;
  });
  const [primaryKey, primaryConv] = sorted[0];
  const others = sorted.slice(1);

  const plan = {
    primaryKey,
    primaryMessages: primaryConv.messages.length,
    toMerge: others.map(([key, conv]) => ({ key, messages: conv.messages.length, contactName: conv.contactName ?? null })),
  };

  if (!apply) {
    return NextResponse.json({ dryRun: true, plan });
  }

  // Junta as mensagens de todas as conversas em ordem cronológica
  const mergedMessages = [...primaryConv.messages];
  for (const [, conv] of others) mergedMessages.push(...conv.messages);
  mergedMessages.sort((a, b) => a.ts - b.ts);

  primaryConv.messages = mergedMessages.slice(-MAX_MESSAGES);
  primaryConv.lastActivity = Math.max(primaryConv.lastActivity, ...others.map(([, c]) => c.lastActivity));
  primaryConv.unread = primaryConv.unread || others.some(([, c]) => c.unread === true);
  primaryConv.aiPaused = primaryConv.aiPaused || others.some(([, c]) => c.aiPaused === true);
  if (!primaryConv.contactName) {
    primaryConv.contactName = others.map(([, c]) => c.contactName).find(Boolean) ?? primaryConv.contactName;
  }

  for (const [key] of others) delete all[key];
  all[primaryKey] = primaryConv;

  writeFileSync(FILE, JSON.stringify(all, null, 2));

  return NextResponse.json({ dryRun: false, applied: true, plan });
}
