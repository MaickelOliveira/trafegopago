import { NextRequest, NextResponse } from "next/server";
import { getClients, getConfig } from "@/lib/clients";
import { getHistory, addMessage } from "@/lib/conversations";
import { generateResponse } from "@/lib/ai-agent";
import { sendWhatsApp } from "@/lib/whatsapp";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { getFunnels } from "@/lib/funnels";

type Body = Record<string, unknown>;

// Extrai phone + text de diferentes formatos de webhook (UazAPI / Evolution API)
function extractMessage(body: Body): { phone: string; text: string; fromMe: boolean } | null {
  // Formato UazAPI padrão
  if (typeof body.phone === "string" && typeof body.message === "string") {
    return {
      phone: body.phone.replace(/\D/g, ""),
      text: body.message,
      fromMe: body.fromMe === true,
    };
  }

  // Formato Evolution API / Baileys
  const data = body.data as Body | undefined;
  if (data) {
    const key = data.key as Record<string, unknown> | undefined;
    if (key?.remoteJid) {
      const phone = String(key.remoteJid).replace("@s.whatsapp.net", "").replace(/\D/g, "");
      const msg = data.message as Record<string, unknown> | undefined;
      const text =
        (msg?.conversation as string) ||
        ((msg?.extendedTextMessage as Record<string, string> | undefined)?.text ?? "");
      const fromMe = key.fromMe === true || key.fromMe === "true";
      return { phone, text, fromMe };
    }
  }

  return null;
}

function isGroup(phone: string): boolean {
  return phone.includes("@g.us") || phone.endsWith("@broadcast");
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  console.log("[WhatsApp webhook]", JSON.stringify(body).slice(0, 300));

  // Repassa para n8n ou URL original (fire-and-forget)
  const config = getConfig();
  if (config.uazapiWebhookForward) {
    fetch(config.uazapiWebhookForward, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) => console.error("[WhatsApp proxy]", e));
  }

  try {
    const extracted = extractMessage(body);

    // Ignora mensagens inválidas e grupos
    if (!extracted || isGroup(extracted.phone)) {
      return NextResponse.json({ ok: true });
    }

    const { phone, text, fromMe } = extracted;

    // Identifica funil e cliente pelo número da instância ou baileysClientId
    const instancePhone = (body.instancePhone as string | undefined)?.replace(/\D/g, "");
    const baileysClientId = body.baileysClientId as string | undefined;
    const baileysFunnelId = body.funnelId as string | undefined;

    let clientId: string | null = null;
    let funnelIdOverride: string | null = null;

    // Baileys: tenta encontrar funil pelo funnelId enviado diretamente
    const funnels = getFunnels();
    if (baileysFunnelId) {
      const matchedFunnel = funnels.find(f => f.id === baileysFunnelId);
      if (matchedFunnel) {
        funnelIdOverride = matchedFunnel.id;
        clientId = matchedFunnel.clientId ?? null;
      }
    }
    if (!clientId && baileysClientId) {
      // fallback: tenta encontrar funil pelo connectionId ou clientId
      const matchedFunnel = funnels.find(f =>
        f.id === baileysClientId ||
        f.connections?.some(c => c.id === baileysClientId)
      );
      if (matchedFunnel) {
        funnelIdOverride = funnelIdOverride ?? matchedFunnel.id;
        clientId = matchedFunnel.clientId ?? null;
      } else {
        clientId = baileysClientId;
      }
    }
    if (!clientId && instancePhone) {
      // Busca funil pelo whatsappPhone
      const matchedFunnel = funnels.find(f => {
        const fp = (f.whatsappPhone ?? "").replace(/\D/g, "");
        return fp.length > 0 && (fp === instancePhone || instancePhone.endsWith(fp.slice(-9)));
      });
      if (matchedFunnel) {
        funnelIdOverride = matchedFunnel.id;
        clientId = matchedFunnel.clientId ?? null;
      }
      // Fallback: busca por cliente
      if (!clientId) {
        const clients = getClients();
        const matched = clients.find((c) => {
          const cp = (c.whatsappPhone ?? "").replace(/\D/g, "");
          return cp.length > 0 && (cp === instancePhone || instancePhone.endsWith(cp.slice(-9)));
        });
        clientId = matched?.id ?? null;
      }
    } else {
      // UazAPI: busca pelo número do contato
      const clients = getClients();
      const matched = clients.find((c) => {
        const cp = (c.whatsappPhone ?? "").replace(/\D/g, "");
        return cp.length > 0 && phone.endsWith(cp.slice(-9));
      });
      clientId = matched?.id ?? null;
    }

    // Auto-captura lead no CRM — qualquer conversa (iniciada por você ou pelo lead)
    const contactName =
      (body.chatName as string) ||
      (body.senderName as string) ||
      (body.pushName as string) ||
      phone;

    const cid = clientId ?? "sem-cliente";
    const isNew = !getLeadByPhone(cid, phone);

    upsertLeadByPhone(cid, phone, {
      clientId: cid,
      funnelId: funnelIdOverride ?? "default",
      source: "whatsapp",
      name: contactName,
      ...(isNew ? { status: "entrada" } : {}),
    });

    if (!text.trim()) return NextResponse.json({ ok: true });

    // Salva a mensagem na conversa (sempre — independente de IA ou fromMe)
    const ts = Date.now();
    addMessage(phone, { role: fromMe ? "assistant" : "user", content: text, ts }, clientId);

    // Se foi você quem mandou pelo celular, só salva — não responde via IA
    if (fromMe) return NextResponse.json({ ok: true });

    // Histórico da conversa
    const history = getHistory(phone);

    // Gera resposta via Claude
    const reply = await generateResponse(text, history, clientId);

    if (!reply) return NextResponse.json({ ok: true });

    addMessage(phone, { role: "assistant", content: reply, ts: Date.now() }, clientId);

    // Envia resposta
    await sendWhatsApp(phone, reply);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[WhatsApp webhook] Erro:", err);
    // Sempre retorna 200 para evitar reenvios do UazAPI
    return NextResponse.json({ ok: true });
  }
}

// Endpoint de verificação
export async function GET() {
  return NextResponse.json({
    status: "online",
    agent: "TráfegoPago WhatsApp AI",
    timestamp: new Date().toISOString(),
  });
}
