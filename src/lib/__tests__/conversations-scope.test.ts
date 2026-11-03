import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDocument, readDocument } from "../document-store";
import { getHistory, getAllConversationsByClientId, setAiPaused, addMessage } from "../conversations";
let directory: string, cwd: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(tmpdir(), "tp-scope-")); process.chdir(directory); });
afterEach(async () => { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); });
const phone = "5544999999999";
const conversation = (clientId: string | null, connId?: string) => ({ clientId, connId, messages: [{ role: "user", content: `${clientId}:${connId}`, ts: Date.now() }], lastActivity: Date.now() });
describe("conversation isolation", () => {
  it("does not list unowned or another client's legacy conversations", async () => {
    await writeDocument("conversations.json", { [phone]: conversation(null), [`b:${phone}`]: conversation("b") });
    expect(await getAllConversationsByClientId("a")).toEqual([]);
    expect(await getHistory(phone, "a")).toEqual([]);
  });
  it("keeps the same telephone separate for each channel", async () => {
    await writeDocument("conversations.json", { [`a:x:${phone}`]: conversation("a", "x"), [`a:y:${phone}`]: conversation("a", "y") });
    expect((await getHistory(phone, "a", "x"))[0].content).toBe("a:x");
    expect(await getHistory(phone, "a", "missing")).toEqual([]);
    expect(await getHistory(phone, "a")).toEqual([]);
    await setAiPaused(phone, true, "a", "x");
    const stored = await readDocument<Record<string, { aiPaused?: boolean }>>("conversations.json", {});
    expect(stored[`a:x:${phone}`].aiPaused).toBe(true);
    expect(stored[`a:y:${phone}`].aiPaused).toBeUndefined();
  });
  it("does not merge a new channel into a legacy conversation", async () => {
    await writeDocument("conversations.json", { [`a:${phone}`]: conversation("a", "x") });
    await addMessage(phone, { role: "user", content: "channel y", ts: Date.now() }, "a", { connId: "y" });
    expect((await getHistory(phone, "a", "x"))[0].content).toBe("a:x");
    expect((await getHistory(phone, "a", "y"))[0].content).toBe("channel y");
  });
  it("preserves the full archive when a conversation exceeds the former 200-message limit",async()=>{
    const messages=Array.from({length:200},(_,i)=>({role:"user",content:"archive "+i,ts:i}));
    await writeDocument("conversations.json",{[`a:x:${phone}`]:{clientId:"a",connId:"x",messages,lastActivity:Date.now()}});
    await addMessage(phone,{role:"assistant",content:"new response",ts:Date.now()},"a",{connId:"x"});
    const history=await getHistory(phone,"a","x");expect(history).toHaveLength(201);expect(history.slice(0,200)).toEqual(messages);expect(history.at(-1)?.content).toBe("new response");
  });
  it("keeps older authorized history visible without exposing it to another client",async()=>{
    const old=Date.now()-40*24*60*60*1000;
    await writeDocument("conversations.json",{[`a:x:${phone}`]:{clientId:"a",connId:"x",messages:[{role:"user",content:"historical fixture",ts:old}],lastActivity:old}});
    expect((await getHistory(phone,"a","x"))[0].content).toBe("historical fixture");expect(await getHistory(phone,"b","x")).toEqual([]);
  });

});
