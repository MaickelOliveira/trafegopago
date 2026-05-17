// Google Imagen 4 Ultra — geração de imagens de altíssima qualidade

const MODEL     = "imagen-4.0-ultra-generate-001";
const BASE_URL  = "https://generativelanguage.googleapis.com/v1beta/models";

function getKey(): string {
  const key = process.env.GOOGLE_IMAGEN_API_KEY;
  if (!key) throw new Error("GOOGLE_IMAGEN_API_KEY não configurado");
  return key;
}

export async function generateImagenImage(prompt: string): Promise<Buffer> {
  const key = getKey();
  const res = await fetch(`${BASE_URL}/${MODEL}:predict?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: "1:1" },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Erro na geração Imagen");

  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Imagem não retornada pelo Imagen");

  return Buffer.from(b64, "base64");
}

export function isImagenAvailable(): boolean {
  return !!process.env.GOOGLE_IMAGEN_API_KEY;
}
