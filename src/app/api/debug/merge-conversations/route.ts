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

function belongsToClient(key: string, conv: Conversation, clientId: string): boolean {
  return conv.clientId === clientId || key.startsWith(`${clientId}:`) || conv.clientId == null;
}

/** Junta um grupo de chaves duplicadas em uma só (a que tiver mais histórico). */
function mergeEntries(all: Record<string, Conversation>, entries: [string, Conversation][], apply: boolean) {
  const sorted = [...entries].sort(([, a], [, b]) => {
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

  if (!apply) return { dryRun: true, plan };

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

  return { dryRun: false, applied: true, plan };
}

/**
 * Junta conversas duplicadas do mesmo lead (mesmo clientId, telefone em formatos
 * diferentes — ex: com e sem o "55") em uma única chave.
 *
 * - Com `phone`: junta as duplicatas desse telefone específico.
 * - Sem `phone` (apenas `clientId`): varre todas as conversas do cliente, agrupa por
 *   telefone canônico e reporta/junta todos os grupos duplicados encontrados.
 *
 * Sem ?apply=1 mostra apenas o plano (dry-run); com ?apply=1 executa de fato.
 */
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  const connId = req.nextUrl.searchParams.get("connId") || null;
  const apply = req.nextUrl.searchParams.get("apply") === "1";

  if (!clientId) {
    return NextResponse.json({ error: "Informe clientId" }, { status: 400 });
  }
  if (!existsSync(FILE)) {
    return NextResponse.json({ error: "conversations.json não encontrado" }, { status: 404 });
  }
  const all: Record<string, Conversation> = JSON.parse(readFileSync(FILE, "utf-8"));

  if (phone) {
    const digits = phone.replace(/\D/g, "");
    const variants = new Set(phoneVariants(digits));

    const matches = Object.entries(all).filter(([key, conv]) => {
      if (!belongsToClient(key, conv, clientId)) return false;
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

    const result = mergeEntries(all, matches, apply);
    if (apply) writeFileSync(FILE, JSON.stringify(all, null, 2));
    return NextResponse.json(result);
  }

  // Modo varredura: agrupa todas as conversas do cliente por (conexão + telefone canônico).
  // Mantém conversas de conexões diferentes em grupos separados (não mescla entre conexões distintas).
  const owned = Object.entries(all).filter(([key, conv]) => belongsToClient(key, conv, clientId));
  const groups = new Map<string, [string, Conversation][]>();
  for (const entry of owned) {
    const [key, conv] = entry;
    const phonePart = phonePartOf(key, clientId, conv).replace(/\D/g, "");
    if (!phonePart) continue;
    const canonical = phoneVariants(phonePart)[0];
    const groupKey = `${conv.connId ?? "_legacy_"}::${canonical}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push(entry);
    groups.set(groupKey, arr);
  }

  const results: Record<string, unknown>[] = [];
  let changed = false;
  for (const [groupKey, entries] of groups) {
    if (entries.length < 2) continue;
    const result = mergeEntries(all, entries, apply);
    if (apply && "applied" in result) changed = true;
    results.push({ group: groupKey, ...result });
  }

  if (apply && changed) writeFileSync(FILE, JSON.stringify(all, null, 2));

  return NextResponse.json({ dryRun: !apply, totalGroups: results.length, groups: results });
}
