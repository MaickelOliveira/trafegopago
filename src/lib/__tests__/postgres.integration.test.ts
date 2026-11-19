import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { databasePool, readDocument, writeDocument, withDataTransaction } from "../document-store";
import { readRecordList, writeRecordList, readRecordMap, writeRecordMap } from "../record-store";
import { scheduleFollowUp, claimDueFollowUps } from "../followups";

describe.runIf(process.env.TEST_POSTGRES === "1")("PostgreSQL transactions", () => {
  beforeEach(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!target.pathname.endsWith("/trafegopago_audit") || target.searchParams.get("host") !== "/private/tmp/trafego-audit-pg-sock") throw new Error("Use the dedicated local audit database.");
    await databasePool().query("TRUNCATE app_documents, app_records");
  });
  afterAll(async () => { await databasePool().end(); });
  it("rolls back all changed collections after an error", async () => {
    await expect(withDataTransaction(async () => {
      await writeDocument("clients.json", { clients: [{ id: "x" }] });
      await writeDocument("leads.json", [{ id: "lead" }]);
      throw new Error("simulated failure");
    })).rejects.toThrow("simulated failure");
    expect(await readDocument("clients.json", null)).toBeNull();
    expect(await readDocument("leads.json", null)).toBeNull();
  });
  it("does not lose parallel updates from independent transactions", async () => {
    await Promise.all(Array.from({ length: 20 }, () => withDataTransaction(async () => {
      const count = await readDocument("counter.json", { count: 0 });
      count.count++;
      await writeDocument("counter.json", count);
    })));
    expect(await readDocument("counter.json", { count: 0 })).toEqual({ count: 20 });
  });
  it("claims each due item only once when two workers run together", async () => {
    await scheduleFollowUp({ clientId: "a", phone: "44999999999", scheduledAt: new Date(Date.now() - 1000).toISOString(), message: "test fixture", type: "followup", connId: "x", stepId: "one" });
    const [first, second] = await Promise.all([claimDueFollowUps(), claimDueFollowUps()]);
    expect([...first, ...second]).toHaveLength(1);
  });
  it("updates a selected record without deleting another client or loaded sibling", async () => {
    await databasePool().query("INSERT INTO app_records(collection,record_key,payload) VALUES('leads.json','one',$1),('leads.json','two',$2)", [JSON.stringify({id:"one",clientId:"a",phone:"44999999999",name:"First"}),JSON.stringify({id:"two",clientId:"b",phone:"44999999999",name:"Other"})]);
    await withDataTransaction(async () => { const rows = await readRecordList<{id:string;name:string}>("leads.json", {clientId:"a"}); expect(rows).toHaveLength(1); rows[0].name="Changed"; await writeRecordList("leads.json",rows); });
    const others = await readRecordList<{id:string;name:string}>("leads.json", {clientId:"b"}); expect(others[0].name).toBe("Other");
    await withDataTransaction(async () => { const rows = await readRecordList<{id:string}>("leads.json", {id:"one"}); await writeRecordList("leads.json",[],rows); });
    expect(await readRecordList("leads.json")).toHaveLength(1);
  });
  it("lists conversation summaries without loading their full history or allowing summary writes", async () => {
    const messages=Array.from({length:200},(_,i)=>({role:"user",content:"message "+i,ts:i}));
    await databasePool().query("INSERT INTO app_records(collection,record_key,payload) VALUES('conversations.json','a:x:5544999999999',$1)",[JSON.stringify({clientId:"a",connId:"x",messages,lastActivity:Date.now()})]);
    const summary=await readRecordMap<{messages:unknown[];_messageCount:number}>("conversations.json",{clientId:"a"},{summary:true});const first=Object.values(summary)[0];expect(first.messages).toHaveLength(1);expect(first._messageCount).toBe(200);
    await expect(writeRecordMap("conversations.json",summary)).rejects.toThrow();
    expect(Object.values(await readRecordMap<{messages:unknown[]}>("conversations.json",{clientId:"a"}))[0].messages).toHaveLength(200);
  });
  it("preserves JSON fields and Unicode during persistence", async () => {
    const original = { phone: "0044999999999", nested: [{ name: "João", notes: "Olá 👋", unknownLegacyField: true }] };
    await withDataTransaction(() => writeDocument("clients.json", original));
    expect(await readDocument("clients.json", null)).toEqual(original);
  });
});
