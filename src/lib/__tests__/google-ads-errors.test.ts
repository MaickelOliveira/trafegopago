import { expect, it } from "vitest";
import { formatGoogleAdsError, googleAdsIssue } from "../google-ads-api";

it("distinguishes account ownership from project access using actual Google error enums", () => {
  expect(googleAdsIssue({ errors: [{ error_code: { authorization_error: 2 } }] })).toBe("account_access");
  expect(googleAdsIssue({ errors: [{ error_code: { authorization_error: 7 } }] })).toBe("project_access");
  expect(googleAdsIssue({ errors: [{ error_code: { authorization_error: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" } }] })).toBe("project_access");
});
it("keeps quota and unclassified failures distinct from missing authorization", () => {
  expect(googleAdsIssue({ errors: [{ error_code: { quota_error: 2 } }] })).toBe("rate_limited");
  expect(googleAdsIssue({ errors: [{ message: "synthetic-private" }] })).toBe("unavailable");
  expect(googleAdsIssue({ response: { status: 429 } })).toBe("rate_limited");
  expect(googleAdsIssue({ errors: [{ error_code: { quota_error: 0 } }] })).toBe("unavailable");
});
it("never serializes provider messages, transport objects or Error messages containing secrets", () => {
  for (const failure of [new Error("synthetic-private-token"), { errors: [{ message: "synthetic-private-token" }] }, { response: { data: { private: "synthetic-private-token" } } }]) {
    expect(formatGoogleAdsError(failure)).toBe("Não foi possível consultar o Google Ads.");
  }
  expect(formatGoogleAdsError({ errors: [{ error_code: { authorization_error: 2 }, message: "synthetic-private-token" }] })).not.toContain("synthetic-private");
});
it("recognizes a known expired grant without reflecting its payload", () => {
  expect(googleAdsIssue({ response: { data: { error: "invalid_grant" } } })).toBe("authorization_expired");
  expect(formatGoogleAdsError(new Error("invalid_grant: synthetic-private"))).toBe("invalid_grant");
});
