import { afterEach, expect, it, vi } from "vitest";
vi.mock("../clients", () => ({getConfig:async()=>({evolutionServer:"https://evolution.example.invalid",evolutionAdminKey:"synthetic-key",appBaseUrl:"https://app.example.invalid"})}));
import { createOrRestartInstance, evolutionWebhookForSession } from "../evolution-api";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("does not restart, log out or redirect events from an existing provider instance during a new registration",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response("name already used",{status:409}));vi.stubGlobal("fetch",fetchMock);
 expect(await createOrRestartInstance("existing-number","https://app.example.invalid/api/whatsapp/webhook/evolution/new",false)).toBeNull();
 expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0][0]).toBe("https://evolution.example.invalid/instance/create");
});
it("builds the event destination exclusively from the configured platform address",async()=>{
 vi.stubEnv("APP_BASE_URL","https://platform.example.invalid");
 expect(await evolutionWebhookForSession("stored-session")).toBe("https://platform.example.invalid/api/whatsapp/webhook/evolution/stored-session");
});
