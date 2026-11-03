import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isPublicAddress } from "./public-webhook";
/** Bounded public HTTPS fetch. Every redirect is independently resolved and pinned. */
export async function fetchPublicResource(destination: string, options: { method?: string; headers?: Record<string, string>; signal?: AbortSignal; redirect?: string } = {}, redirects = 0): Promise<{ ok: boolean; status: number; headers: Headers; url: string; arrayBuffer: () => Promise<ArrayBuffer> }> {
  const url = new URL(destination);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw Error("A mídia deve usar HTTPS público.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw Error("Destino de mídia não permitido.");
  const chosen = addresses[0];
  const result = await new Promise<{ status: number; headers: Headers; body: Buffer }>((resolve, reject) => {
    const req = request(url, { method: options.method || "GET", headers: options.headers, signal: options.signal, timeout: 15_000,
      lookup: (_hostname, opts, callback) => { if (typeof opts === "object" && opts.all) callback(null, [chosen]); else callback(null, chosen.address, chosen.family); },
    }, response => {
      const limit = 25 * 1024 * 1024; let size = 0; const chunks: Buffer[] = [];
      const headers = new Headers(); for (const [name, value] of Object.entries(response.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      if (Number(headers.get("content-length")) > limit) { response.destroy(Error("Mídia maior que 25 MB.")); return; }
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > limit) response.destroy(Error("Mídia maior que 25 MB.")); else chunks.push(chunk); });
      response.on("error", reject); response.on("end", () => resolve({ status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(Error("Tempo de download esgotado."))); req.on("error", reject); req.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.has("location")) {
    if (redirects >= 3) throw Error("Muitos redirecionamentos de mídia.");
    const next = new URL(result.headers.get("location")!, url);
    // Provider credentials must never follow a redirect to another host.
    if (next.origin !== url.origin && options.headers && Object.keys(options.headers).some(key => /authorization|cookie|token|key/i.test(key))) throw Error("Redirecionamento de credencial bloqueado.");
    return fetchPublicResource(next.toString(), options, redirects + 1);
  }
  return { ok: result.status >= 200 && result.status < 300, status: result.status, headers: result.headers, url: url.toString(), arrayBuffer: async () => Uint8Array.from(result.body).buffer };
}
