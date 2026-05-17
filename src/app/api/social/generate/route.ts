import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, getConfig } from "@/lib/clients";
import { generateImage } from "@/lib/nanobanana";
import { generateImagenImage, isImagenAvailable } from "@/lib/imagen";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const CLIENTES_DIR = path.join(process.cwd(), "..", "clientes");

function resolveClienteDir(clientId: string): string {
  const exact = path.join(CLIENTES_DIR, clientId);
  if (existsSync(exact)) return exact;
  const short = clientId.split("-")[0];
  const byShort = path.join(CLIENTES_DIR, short);
  if (existsSync(byShort)) return byShort;
  // Cria a pasta se não existir
  mkdirSync(exact, { recursive: true });
  return exact;
}

async function saveImageBufferToClient(clientId: string, buffer: Buffer, tema: string): Promise<string> {
  const clienteDir   = resolveClienteDir(clientId);
  const criativosDir = path.join(clienteDir, "criativos");
  mkdirSync(criativosDir, { recursive: true });

  const slug     = tema.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const filename  = `${slug}-${Date.now()}.png`;
  writeFileSync(path.join(criativosDir, filename), buffer);

  const folderName = path.basename(clienteDir);
  return `/api/social/imagem/${folderName}/criativos/${filename}`;
}

// Mantém compatibilidade — salva a partir de URL
async function saveImageToClient(clientId: string, imageUrl: string, tema: string): Promise<string> {
  const res    = await fetch(imageUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  return saveImageBufferToClient(clientId, buffer, tema);
}

type MarcaProfile = {
  nome: string; handle: string; site: string;
  cores: { fundo: string; primaria: string; texto: string };
  estilo: string; tipografia: string; logo: string; rodape: string;
  promptBase: string; referencias: string[];
};

function getMarca(clientId: string): MarcaProfile | null {
  // Busca em /Claude Code/clientes/{clientId}/marca.json
  const base = path.join(process.cwd(), "..", "clientes");
  const byId   = path.join(base, clientId, "marca.json");
  // Tenta também pelo nome simplificado (ex: nexo-pro → nexo)
  const short  = clientId.split("-")[0];
  const byShort = path.join(base, short, "marca.json");

  if (existsSync(byId))    return JSON.parse(readFileSync(byId, "utf-8"));
  if (existsSync(byShort)) return JSON.parse(readFileSync(byShort, "utf-8"));
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, tema, plataforma, formato, tom } = body;

  if (!clientId || !tema) {
    return NextResponse.json({ error: "clientId e tema são obrigatórios" }, { status: 400 });
  }

  const client = getClientById(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const config = getConfig();
  if (!config.anthropicApiKey) {
    return NextResponse.json({ error: "Anthropic API key não configurada" }, { status: 400 });
  }

  const ai = new Anthropic({ apiKey: config.anthropicApiKey });
  const marca = getMarca(clientId);

  const brandContext = marca
    ? `\nIdentidade visual da marca:
- Estilo: ${marca.estilo}
- Cores: fundo ${marca.cores.fundo}, cor primária ${marca.cores.primaria}, texto ${marca.cores.texto}
- Logo: ${marca.logo}
- Rodapé: ${marca.rodape}
- Tipografia: ${marca.tipografia}`
    : "";

  // Claude gera legenda + prompt visual
  const prompt = `Você é um especialista em social media para agências de tráfego pago.

Cliente: ${client.name}
Tema do post: ${tema}
Plataforma: ${plataforma ?? "Instagram"}
Formato: ${formato ?? "Post estático"}
Tom de voz: ${tom ?? "Profissional e direto"}${brandContext}

Gere um JSON com exatamente este formato (sem markdown, sem explicações):
{
  "legenda": "legenda completa do post com emojis e hashtags no final",
  "promptImagem": "descrição detalhada em inglês para gerar a imagem respeitando a identidade visual da marca",
  "cta": "chamada para ação curta",
  "hashtags": ["tag1", "tag2", "tag3"]
}

A legenda deve ter hook forte na primeira linha, conteúdo de valor e CTA claro. O prompt de imagem DEVE incorporar a identidade visual da marca (cores, estilo, logo, rodapé).`;

  const response = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: "Erro ao gerar conteúdo" }, { status: 500 });
  }

  let content: { legenda: string; promptImagem: string; cta: string; hashtags: string[] };
  try {
    content = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json({ error: "Erro ao parsear conteúdo" }, { status: 500 });
  }

  // Monta o prompt final da imagem com identidade da marca
  const basePrompt = marca?.promptBase ?? "professional social media graphic, high quality design";
  const imagePrompt = `${basePrompt}, ${content.promptImagem}, ${plataforma ?? "Instagram"} post format, ultra high quality`;

  // Se tem referências da marca, usa image-to-image para manter consistência
  const refImages = marca?.referencias?.slice(0, 1) ?? [];

  try {
    let imageBuffer: Buffer | null = null;

    // Usa Imagen 4 Ultra se disponível (qualidade máxima), senão Nano Banana
    if (isImagenAvailable()) {
      imageBuffer = await generateImagenImage(imagePrompt);
    } else {
      const rawUrl = await generateImage(imagePrompt, refImages.length > 0 ? refImages : undefined);
      const res = await fetch(rawUrl);
      imageBuffer = Buffer.from(await res.arrayBuffer());
    }

    const imageUrl = await saveImageBufferToClient(clientId, imageBuffer, tema);
    return NextResponse.json({ ...content, imageUrl, tema, plataforma, formato, modelo: isImagenAvailable() ? "imagen-4-ultra" : "nanobanana" });
  } catch (err) {
    return NextResponse.json({ ...content, imageUrl: null, erro: String(err), tema, plataforma, formato });
  }
}
