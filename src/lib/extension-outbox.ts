import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/** Fila de respostas da IA esperando serem entregues pela extensão. Existe
 *  porque, diferente de Evolution/UazAPI/Meta (o servidor chama a API deles
 *  direto), o único jeito de mandar mensagem pelo WhatsApp Web pessoal do
 *  cliente é através da própria aba do navegador dele — o servidor não
 *  consegue "empurrar" nada pra um Chrome, então a extensão busca (polling,
 *  ver extension/src/content-script.ts). */
export type PendingReply = {
  id: string;
  deviceId: string;
  chatId: string;   // JID completo (ex "5511999998888@c.us")
  phone: string;    // dígitos — usado só pra registrar no histórico após entrega
  text: string;
  createdAt: string;
  deliveredAt?: string;
  failedAt?: string;
  error?: string;
};

// Calculado a cada chamada — permite que os testes isolem o arquivo via
// process.chdir() num diretório temporário (mesmo padrão de extension-devices.ts).
function getFilePath(): string {
  return path.join(process.cwd(), "data", "extension-outbox.json");
}

function load(): PendingReply[] {
  const FILE = getFilePath();
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as PendingReply[];
  } catch {
    return [];
  }
}

function save(replies: PendingReply[]) {
  const FILE = getFilePath();
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(replies, null, 2));
}

export function queueReply(deviceId: string, chatId: string, phone: string, text: string): PendingReply {
  const replies = load();
  const reply: PendingReply = {
    id: randomUUID(),
    deviceId,
    chatId,
    phone,
    text,
    createdAt: new Date().toISOString(),
  };
  replies.push(reply);
  save(replies);
  return reply;
}

/** Só as ainda não entregues nem falhas — uma vez resolvida (sucesso ou
 *  falha), sai da fila que a extensão busca (o ack já processou o resultado,
 *  não faz sentido reoferecer). */
export function getPendingReplies(deviceId: string): PendingReply[] {
  return load().filter((r) => r.deviceId === deviceId && !r.deliveredAt && !r.failedAt);
}

export function markDelivered(id: string): PendingReply | null {
  const replies = load();
  const idx = replies.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  replies[idx] = { ...replies[idx], deliveredAt: new Date().toISOString() };
  save(replies);
  return replies[idx];
}

export function markFailed(id: string, error: string): PendingReply | null {
  const replies = load();
  const idx = replies.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  replies[idx] = { ...replies[idx], failedAt: new Date().toISOString(), error };
  save(replies);
  return replies[idx];
}
