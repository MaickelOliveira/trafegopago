import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { createGoogleAdsCustomer } from "../google-ads-customer";

it("makes an SDK query without the retired header while preserving OAuth and manager scope", async () => {
  const require = createRequire(import.meta.url);
  const sdkRequire = createRequire(require.resolve("google-ads-api"));
  const axios = sdkRequire("axios");
  const previous = axios.defaults.adapter;
  const requests: { headers: { has(name: string): boolean; get(name: string): unknown }; url: string }[] = [];
  axios.defaults.adapter = async (request: typeof requests[number]) => {
    requests.push(request);
    return { status: 200, statusText: "OK", headers: {}, config: request, data: Readable.from([Buffer.from(JSON.stringify([{ results: [{ customer: { id: "1234567890" }, metrics: { costMicros: "1230000" } }] }]))]) };
  };
  try {
    const customer = createGoogleAdsCustomer({ clientId: "synthetic-app", clientSecret: "synthetic-secret", refreshToken: "synthetic-refresh", loginCustomerId: "222-333-4444", developerToken: "synthetic-retired-token" }, "123-456-7890");
    vi.spyOn(customer, "getAccessToken").mockResolvedValue("synthetic-access");
    const rows = await customer.query("SELECT customer.id, metrics.cost_micros FROM customer LIMIT 1");
    expect(rows).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.has("developer-token")).toBe(false);
    expect(requests[0].headers.get("Authorization")).toBe("Bearer synthetic-access");
    expect(requests[0].headers.get("login-customer-id")).toBe("2223334444");
    expect(requests[0].url).toContain("/customers/1234567890/");
    expect(JSON.stringify(requests)).not.toContain("synthetic-secret");
    expect(JSON.stringify(requests)).not.toContain("synthetic-retired-token");
  } finally { axios.defaults.adapter = previous; vi.restoreAllMocks(); }
});
