import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export type CreativeStatus = "pending" | "approved" | "rejected" | "published";
export type FileType = "image" | "video" | "url";

export type CreativeCopy = {
  headline: string;
  body: string;
  cta: string;
  link: string | null;
};

export type CreativeComment = {
  by: "manager" | "client";
  text: string;
  at: string;
};

export type Creative = {
  id: string;
  clientId: string;
  adAccountId: string;
  sentBy: "manager" | "client";
  status: CreativeStatus;
  fileType: FileType;
  filePath: string | null;
  fileUrl: string | null;
  copy: CreativeCopy;
  metaAdId: string | null;
  metaCreativeId: string | null;
  rejectionComment: string | null;
  comments: CreativeComment[];
  createdAt: string;
  updatedAt: string;
};

const DATA_PATH = path.join(process.cwd(), "data", "creatives.json");

export function getCreatives(): Creative[] {
  if (!existsSync(DATA_PATH)) return [];
  try {
    const raw = readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw).items as Creative[];
  } catch {
    return [];
  }
}

export function getCreativesByClient(clientId: string): Creative[] {
  return getCreatives().filter((c) => c.clientId === clientId);
}

export function getCreativeById(id: string): Creative | undefined {
  return getCreatives().find((c) => c.id === id);
}

export function saveCreative(creative: Creative) {
  const all = getCreatives();
  all.push(creative);
  writeFileSync(DATA_PATH, JSON.stringify({ items: all }, null, 2));
}

export function updateCreative(updated: Creative) {
  const all = getCreatives();
  const idx = all.findIndex((c) => c.id === updated.id);
  if (idx >= 0) {
    all[idx] = { ...updated, updatedAt: new Date().toISOString() };
    writeFileSync(DATA_PATH, JSON.stringify({ items: all }, null, 2));
  }
}

export function deleteCreative(id: string) {
  const all = getCreatives().filter((c) => c.id !== id);
  writeFileSync(DATA_PATH, JSON.stringify({ items: all }, null, 2));
}

export function countPending(clientId: string, forRole: "manager" | "client"): number {
  return getCreativesByClient(clientId).filter(
    (c) => c.status === "pending" && c.sentBy !== forRole
  ).length;
}
