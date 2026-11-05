import { describe, expect, it } from "vitest";
import { publicFunnel, publicTemplate } from "../public-records";
import type { Funnel } from "../funnels";
import type { WabaTemplate } from "../waba-templates";
it("keeps the client-visible funnel usable without provider credentials", () => {
 const funnel = { id: "f", name: "F", clientId: "a", columns: [], connections: [{ id: "c", phone: "test", type: "meta", metaToken: "private-key", metaVerifyToken: "verify-key", metaPhoneNumberId: "123" }] } as Funnel;
 const safe = publicFunnel(funnel); expect(safe.connections?.[0]).toEqual({ id: "c", phone: "test", type: "meta", metaPhoneNumberId: "123" }); expect(JSON.stringify(safe)).not.toContain("private-key"); expect(funnel.connections?.[0].metaToken).toBe("private-key");
});
it("keeps template content and hides its sending token", () => {
 const safe = publicTemplate({ id: "t", name: "hello", components: [], metaToken: "private-key" } as unknown as WabaTemplate);
 expect(safe?.name).toBe("hello"); expect(safe?.metaToken).toBeUndefined(); expect(publicTemplate(null)).toBeNull();
});
