import { Customer } from "google-ads-api";
import type { GoogleAdsCreds } from "./google-ads-api";

/** Bridge the SDK's legacy required field to Google's project-based authorization.
 * An empty developer-token header is rejected; the header must be absent. */
class ProjectGoogleAdsCustomer extends Customer {
  protected override get callHeaders() {
    const headers = super.callHeaders;
    Reflect.deleteProperty(headers, "developer-token");
    return headers;
  }
}

export function createGoogleAdsCustomer(creds: GoogleAdsCreds, customerId: string) {
  return new ProjectGoogleAdsCustomer({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    developer_token: "", // Required only by the installed SDK's constructor type.
  }, {
    customer_id: customerId.replace(/\D/g, ""),
    refresh_token: creds.refreshToken,
    login_customer_id: creds.loginCustomerId?.replace(/\D/g, "") || undefined,
  });
}
