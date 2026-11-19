import { afterEach,describe,expect,it,vi } from "vitest";
import { signedAdAssetPath,verifyAdAssetAccess } from "../ad-media-access";
afterEach(()=>vi.unstubAllEnvs());
describe("owned advertising media previews",()=>{
 it("binds the preview to the client, account, media ID and kind",()=>{
  vi.stubEnv("JWT_SECRET","test-only-key".repeat(4));
  const url=new URL(signedAdAssetPath("video","123","act_456","a"),"https://example.invalid");
  expect(verifyAdAssetAccess(url,"video","123","a")).toBe(true);
  expect(verifyAdAssetAccess(url,"video","123","b")).toBe(false);
  expect(verifyAdAssetAccess(url,"ig","123","a")).toBe(false);
  url.searchParams.set("accountId","act_999");expect(verifyAdAssetAccess(url,"video","123","a")).toBe(false);
 });
 it("rejects an expired preview or an unsigned asset ID",()=>{
  vi.stubEnv("JWT_SECRET","test-only-key".repeat(4));
  const url=new URL(signedAdAssetPath("ig","123","456","a"),"https://example.invalid");
  url.searchParams.set("expires","1000000000");expect(verifyAdAssetAccess(url,"ig","123","a")).toBe(false);
  expect(verifyAdAssetAccess(new URL("https://example.invalid/api/meta/video/123"),"video","123","a")).toBe(false);
 });
});
