import type { Client } from "./clients";
import { AVAILABLE_SYSTEMS } from "./systems";

export function publicClientSettings(client: Client) {
  return { id: client.id, name: client.name, email: client.email, color: client.color, logoUrl: client.logoUrl, cplTarget: client.cplTarget, funnelType: client.funnelType, trackingFunnelId: client.trackingFunnelId, adAccounts: client.adAccounts, enabledSystems: client.enabledSystems, pixelId: client.pixelId, metaPageId: client.metaPageId, googleAdsId: client.googleAdsId, googleConvLabel: client.googleConvLabel, capiTestEventCode: client.capiTestEventCode, hasCapiToken: !!client.capiToken };
}
export function parseClientSettings(body: unknown, creating = false): { patch: Partial<Client>; password?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Cadastro inválido.");
  const input = body as Record<string, unknown>;
  const patch: Partial<Client> = {};
  for (const key of ["name", "email", "color", "pixelId", "metaPageId", "googleAdsId", "googleConvLabel", "capiTestEventCode", "trackingFunnelId"] as const) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "string" || input[key].length > (key === "email" ? 254 : 200)) throw Error("Dados de cadastro inválidos.");
    patch[key] = input[key].trim();
  }
  if (patch.name !== undefined && !patch.name) throw Error("Informe o nome do cliente.");
  if (patch.email !== undefined) { patch.email = patch.email.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) throw Error("Informe um e-mail válido."); }
  if (patch.color !== undefined && !/^#[\da-f]{6}$/i.test(patch.color)) throw Error("Escolha uma cor válida.");
  if (creating && patch.trackingFunnelId) throw Error("Cadastre o cliente antes de escolher seu funil de entrada.");
  if (creating && (!patch.name || !patch.email)) throw Error("Preencha nome e e-mail.");
  if (input.cplTarget !== undefined) { if (typeof input.cplTarget !== "number" || !Number.isFinite(input.cplTarget) || input.cplTarget < 0 || input.cplTarget > 1e9) throw Error("Meta de custo inválida."); patch.cplTarget = input.cplTarget; }
  if (input.funnelType !== undefined) { if (!["leads", "sales", "traffic"].includes(String(input.funnelType))) throw Error("Objetivo inválido."); patch.funnelType = input.funnelType as Client["funnelType"]; }
  if (input.enabledSystems !== undefined) { if (!Array.isArray(input.enabledSystems) || input.enabledSystems.some(value => !AVAILABLE_SYSTEMS.some(system => system.slug === value))) throw Error("Sistema inválido."); patch.enabledSystems = [...new Set(input.enabledSystems)]; }
  if (input.adAccounts !== undefined) {
    if (!Array.isArray(input.adAccounts) || input.adAccounts.length > 100) throw Error("Lista de contas inválida.");
    patch.adAccounts = input.adAccounts.map(item => { if (!item || typeof item.id !== "string" || !/^(act_)?\d{3,30}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 200 || !["meta", "google"].includes(item.platform)) throw Error("Confira o identificador e o nome das contas de anúncios."); return { id: item.id, name: item.name.trim(), platform: item.platform }; });
    if (new Set(patch.adAccounts.map(item => `${item.platform}:${item.id}`)).size !== patch.adAccounts.length) throw Error("Há contas duplicadas.");
  }
  if (input.capiToken) { if (typeof input.capiToken !== "string" || input.capiToken.length > 4096) throw Error("Chave de conversão inválida."); patch.capiToken = input.capiToken.trim(); }
  let password: string | undefined;
  if (input.password || creating) { if (typeof input.password !== "string" || input.password.length < 12 || Buffer.byteLength(input.password, "utf8") > 72) throw Error("A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes."); password = input.password; }
  return { patch, password };
}
