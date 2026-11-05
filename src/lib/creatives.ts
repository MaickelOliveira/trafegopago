import { readDocument, writeDocument, withDataTransaction } from "./document-store";
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
  by: "manager" | "client" | "employee";
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

export async function getCreatives(): Promise<Creative[]> {
  return (await readDocument<{ items: Creative[] }>("creatives.json", { items: [] })).items;
}

export async function getCreativesByClient(clientId: string): Promise<Creative[]> {
  return (await getCreatives()).filter((c) => c.clientId === clientId);
}

export async function getCreativeById(id: string): Promise<Creative | undefined> {
  return (await getCreatives()).find((c) => c.id === id);
}

export async function saveCreative(creative: Creative) {
  return withDataTransaction(async () => {
  const all = (await getCreatives());
  all.push(creative);
  await writeDocument("creatives.json", { items: all });

  });
}

export async function updateCreative(updated: Creative) {
  return withDataTransaction(async () => {
  const all = (await getCreatives());
  const idx = all.findIndex((c) => c.id === updated.id);
  if (idx >= 0) {
    all[idx] = { ...updated, updatedAt: new Date().toISOString() };
    await writeDocument("creatives.json", { items: all });
  }

  });
}

export async function deleteCreative(id: string) {
  return withDataTransaction(async () => {
  const all = (await getCreatives()).filter((c) => c.id !== id);
  await writeDocument("creatives.json", { items: all });

  });
}

export async function countPending(clientId: string, forRole: "manager" | "client"): Promise<number> {
  return (await getCreativesByClient(clientId)).filter(
    (c) => c.status === "pending" && c.sentBy !== forRole
  ).length;
}
