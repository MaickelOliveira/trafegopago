import { afterEach, expect, it, vi } from "vitest";
import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
const registered = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../media-access", () => ({ registerMediaFile: registered }));
import { saveDecryptedMedia } from "../media-transcribe";
import { chatMediaMessage, decodeChatMediaBase64 } from "../chat-media-message";
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
