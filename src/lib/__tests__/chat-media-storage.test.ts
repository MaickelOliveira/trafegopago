import { afterEach, expect, it, vi } from "vitest";
import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
const registered = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../media-access", () => ({ registerMediaFile: registered }));
import { saveDecryptedMedia } from "../media-transcribe";
import { chatMediaMessage, decodeChatMediaBase64, findWhatsAppMessageObject } from "../chat-media-message";
import { chatFileDownload, chatFileName, chatFileSize } from "../chat-attachments";
const saved: string[] = [];
afterEach(async () => { await Promise.all(saved.splice(0).map(file => unlink(file))); vi.clearAllMocks(); vi.restoreAllMocks(); });
it("decodes provider data URIs and refuses malformed, empty or oversized base64", () => {
  const content=Buffer.from("OggS synthetic audio");
  expect(decodeChatMediaBase64(`data:audio/ogg;base64,${content.toString("base64")}`)).toEqual(content);
  for (const value of [null, {}, "", "@@@", "a", "A".repeat(35 * 1024 * 1024)]) expect(decodeChatMediaBase64(value)).toBeUndefined();
});
it("stores an authorized media reference and private file independently of transcription", async () => {
  const buffer=Buffer.from("OggS synthetic fixture");
  const url=await saveDecryptedMedia(buffer,"synthetic",1000,"audio/ogg; codecs=opus","client-a","connection-a");
  const destination=path.join(process.cwd(),"data","media",url.split("/").pop()!); saved.push(destination);
  expect(await readFile(destination)).toEqual(buffer);expect((await stat(destination)).mode&0o777).toBe(0o600);
  expect(registered).toHaveBeenCalledWith(url,"client-a","connection-a");expect(url).toMatch(/^\/api\/media\/[a-f0-9-]+\.ogg$/);
});
it("uses the audio MP4 extension and rejects mismatched file contents", async () => {
  const url=await saveDecryptedMedia(Buffer.from([0,0,0,20,102,116,121,112]),"synthetic",1000,"audio/mp4","client-a","connection-a");
  saved.push(path.join(process.cwd(),"data","media",url.split("/").pop()!)); expect(url.endsWith(".m4a")).toBe(true);
  await expect(saveDecryptedMedia(Buffer.from("<script>bad</script>"),"synthetic",1000,"audio/ogg","client-a","connection-a")).rejects.toThrow();
  await expect(saveDecryptedMedia(Buffer.from("OggS"),"synthetic",1000,"text/html","client-a","connection-a")).rejects.toThrow();
});
it.each(["user","assistant"] as const)("keeps the attachment for %s messages without AI or transcription", async role => {
  const persist=vi.fn().mockResolvedValue("/api/media/fixture.ogg");
  const result=await chatMediaMessage({role,content:"[Áudio de 2s]",ts:1000,type:"audio",messageId:"synthetic-id",buffer:Buffer.from("OggS"),mimeType:"audio/ogg",phone:"synthetic",clientId:"client-a",connId:"connection-a"},persist);
  expect(result).toEqual({role,content:"[Áudio de 2s]",ts:1000,type:"audio",messageId:"synthetic-id",mediaUrl:"/api/media/fixture.ogg"});
  expect(persist).toHaveBeenCalledWith(expect.any(Buffer),"synthetic",1000,"audio/ogg","client-a","connection-a");
});
it("preserves an honest audio message when the file cannot be recovered", async () => {
  vi.spyOn(console,"warn").mockImplementation(()=>{});
  const result=await chatMediaMessage({role:"user",content:"[Áudio]",ts:1000,type:"audio",buffer:Buffer.from("invalid"),mimeType:"audio/ogg",phone:"synthetic",clientId:"client-a",connId:"connection-a"},vi.fn().mockRejectedValue(Error("unavailable")));
  expect(result).toEqual({role:"user",content:"[Áudio]",ts:1000,type:"audio"});
});
it("stores real PDF signatures as PDF and other documents as private opaque downloads", async () => {
  for (const [data, mime, extension] of [["%PDF-1.7\nfixture", "application/octet-stream", "pdf"], ["PK synthetic office file", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "bin"], ["<script>fixture</script>", "text/html", "bin"]]) {
    const url=await saveDecryptedMedia(Buffer.from(data),"synthetic",1000,mime,"client-a","connection-a","document");
    saved.push(path.join(process.cwd(),"data","media",url.split("/").pop()!)); expect(url.endsWith(`.${extension}`)).toBe(true); expect(registered).toHaveBeenLastCalledWith(url,"client-a","connection-a");
  }
  await expect(saveDecryptedMedia(Buffer.alloc(25*1024*1024+1),"synthetic",1000,"application/pdf","client-a","connection-a","document")).rejects.toThrow();
});
it.each(["user","assistant"] as const)("archives documents for %s without changing their channel", async role => {
  const result=await chatMediaMessage({role,content:"[Documento]",ts:1000,type:"document",fileName:"../../Orçamento.pdf",messageId:"synthetic-doc",buffer:Buffer.from("%PDF-fixture"),mimeType:"application/pdf",phone:"synthetic",clientId:"client-a",connId:"connection-a"});
  saved.push(path.join(process.cwd(),"data","media",result.mediaUrl!.split("/").pop()!));
  expect(result).toMatchObject({role,type:"document",fileName:"Orçamento.pdf",mimeType:"application/pdf",fileSize:12,messageId:"synthetic-doc"});
});
it("recognizes captioned and ephemeral documents with bounded unwrapping", () => {
  const document={fileName:"Pedido.pdf",mimetype:"application/pdf"};
  expect(findWhatsAppMessageObject({ephemeralMessage:{message:{documentWithCaptionMessage:{message:{documentMessage:document}}}}})).toEqual({type:"documentMessage",obj:document});
  expect(findWhatsAppMessageObject({documentMessage:document})).toEqual({type:"documentMessage",obj:document});
  const cycle:Record<string,unknown>={};cycle.ephemeralMessage={message:cycle};expect(findWhatsAppMessageObject(cycle)).toBeNull();
});
it("keeps filenames safe and retains signatures on attachment downloads", () => {
  expect(chatFileName("../../Pedido\r\n.pdf")).toBe("Pedido.pdf"); expect(chatFileName("\u202efile.pdf")).toBe("file.pdf");
  expect(chatFileDownload("/api/media/a.pdf?expires=123&signature=abc","Pedido.pdf")).toContain("expires=123&signature=abc&download=1&name=Pedido.pdf");
  expect(chatFileDownload("https://provider.example/file","Pedido.pdf")).toBe("https://provider.example/file"); expect(chatFileSize(1024)).toBe("1 KB"); expect(chatFileSize(-1)).toBe("");
});
