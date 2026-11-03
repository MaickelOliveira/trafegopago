import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0 || a >= 224);
  }
  if (isIP(normalized) !== 6 || normalized.includes(".")) return false;
  // Accept globally routable unicast only. This excludes loopback, mapped IPv4,
  // unique local, link local, multicast and unspecified IPv6 addresses.
  return /^[23][0-9a-f]{0,3}:/.test(normalized) && !normalized.startsWith("2001:db8:");
}

/** Resolve once, validate every address and pin the request to that resolution. */
export async function postPublicWebhook(destination: string, body: string): Promise<void> {
  const url = new URL(destination);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("Webhook deve usar HTTPS na porta padrão.");
  if (Buffer.byteLength(body) > 256 * 1024) throw new Error("Conteúdo do webhook muito grande.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error("Destino de webhook não permitido.");
  const chosen = addresses[0];
  await new Promise<void>((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [chosen]);
        else callback(null, chosen.address, chosen.family);
      },
      timeout: 10_000,
    }, response => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(new Error("O webhook não confirmou o recebimento."));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo do webhook esgotado.")));
    req.on("error", reject);
    req.end(body);
  });
}
