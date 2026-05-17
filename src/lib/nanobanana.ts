const BASE = "https://api.nanobananaapi.ai/api/v1/nanobanana";

function getKey(): string {
  const key = process.env.NANOBANANA_API_KEY;
  if (!key) throw new Error("NANOBANANA_API_KEY não configurado");
  return key;
}

type GenerateParams = {
  prompt: string;
  type?: "TEXTTOIAMGE" | "IMAGETOIAMGE";
  numImages?: number;
  imageUrls?: string[];
};

type TaskResult = {
  taskId: string;
  successFlag: 0 | 1 | 2 | 3;
  resultImageUrl?: string;
  errorMessage?: string;
};

async function createTask(params: GenerateParams): Promise<string> {
  const res = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: params.prompt,
      type: params.type ?? "TEXTTOIAMGE",
      numImages: params.numImages ?? 1,
      imageUrls: params.imageUrls ?? [],
      callBackUrl: "https://webhook.site/noop",
    }),
  });

  const data = await res.json();
  if (data.code !== 200) throw new Error(data.msg ?? "Erro ao criar task");
  return data.data.taskId;
}

async function pollTask(taskId: string, maxWait = 60000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 3000));

    const res = await fetch(`${BASE}/record-info?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${getKey()}` },
    });
    const data = await res.json();
    const task: TaskResult = data.data;

    if (task.successFlag === 1 && task.resultImageUrl) {
      return task.resultImageUrl;
    }
    if (task.successFlag === 2 || task.successFlag === 3) {
      throw new Error(task.errorMessage ?? "Geração falhou");
    }
  }
  throw new Error("Timeout na geração de imagem");
}

// Gera uma imagem e aguarda o resultado (max 60s)
export async function generateImage(prompt: string, imageUrls?: string[]): Promise<string> {
  const type = imageUrls && imageUrls.length > 0 ? "IMAGETOIAMGE" : "TEXTTOIAMGE";
  const taskId = await createTask({ prompt, type, imageUrls });
  return pollTask(taskId);
}

// Gera múltiplas imagens (ex: carrossel)
export async function generateImages(prompt: string, count: number): Promise<string[]> {
  const taskId = await createTask({ prompt, numImages: Math.min(count, 4) });
  const url = await pollTask(taskId);
  // Nano Banana retorna uma URL com todas as imagens — split por vírgula se múltiplas
  return url.split(",").map((u) => u.trim()).filter(Boolean);
}
