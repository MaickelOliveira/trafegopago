/** Plain attachment metadata shared by the history and its two chat views. */
export function chatFileName(value: unknown, fallback = "Arquivo"): string {
  if (typeof value !== "string") return fallback;
  return value.normalize("NFKC").split(/[/\\]/).pop()!.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 180) || fallback;
}

export function chatFileDownload(source: string, fileName: string): string {
  // Only our own routes understand these parameters. Provider URLs stay intact.
  if (!/^\/api\/(?:media|uploads)\//.test(source)) return source;
  const url = new URL(source, "https://nexo.invalid");
  url.searchParams.set("download", "1");
  url.searchParams.set("name", chatFileName(fileName));
  return url.pathname + url.search;
}

export function chatFileSize(bytes?: number): string {
  if (!Number.isFinite(bytes) || !bytes || bytes < 0) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
