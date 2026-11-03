import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ conversations: [] as { phone: string; connId: string }[], funnels: [] as { id: string; clientId: string; connections: { id: string;type:"meta" }[] }[] }));
vi.mock("../funnels", () => ({ getFunnels: async () => state.funnels }));
vi.mock("../conversations", () => ({ getAllConversationsByClientId: async () => state.conversations, phoneVariants: (phone: string) => [phone] }));
vi.mock("../evolution-sessions", () => ({ getEvolutionSessions: async () => [] }));
import { resolveConversationChannel } from "../conversation-channel";
beforeEach(() => { state.conversations = []; state.funnels = [{ id: "f", clientId: "a", connections: [{ id: "x",type:"meta" }, { id: "y",type:"meta" }] }, { id: "other", clientId: "b", connections: [{ id: "foreign",type:"meta" }] }]; });
describe("conversation channel selection", () => {
 it("does not replace an explicit missing or foreign channel with the first one", async () => { expect(await resolveConversationChannel("a", "phone", "f", "missing")).toBeUndefined(); expect(await resolveConversationChannel("a", "phone", undefined, "foreign")).toBeUndefined(); });
 it("requires a selection if the telephone has histories on multiple channels", async () => { state.conversations = [{ phone: "phone", connId: "x" }, { phone: "phone", connId: "y" }]; expect(await resolveConversationChannel("a", "phone", "f")).toBeUndefined(); expect(await resolveConversationChannel("a", "phone", "f", "y")).toBe("y"); });
 it("chooses the only related history and excludes histories outside the funnel", async () => { state.conversations = [{ phone: "phone", connId: "y" }, { phone: "phone", connId: "foreign" }]; expect(await resolveConversationChannel("a", "phone", "f")).toBe("y"); });
 it("uses a new channel only when there is a single unambiguous candidate", async () => { expect(await resolveConversationChannel("a", "phone", "f")).toBeUndefined(); state.funnels[0].connections = [{ id: "x",type:"meta" }]; expect(await resolveConversationChannel("a", "phone", "f")).toBe("x"); });
});
