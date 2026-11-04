import { afterEach, expect, it, vi } from "vitest";
import { dashboardInsights, loadDashboardData } from "../dashboard-data";
import { datePresetToRange } from "../date-presets";
afterEach(()=>vi.useRealTimers());
it("keeps Google conversions and value without inventing WhatsApp messages or reach",()=>{
 const result=dashboardInsights("google",{spend:40,impressions:10000,clicks:50,conversions:2.5,conversionsValue:300});
 expect(result).toMatchObject({conversions:2.5,revenue:300,leads:0,purchases:0,conversations:0,ctr:.5,cpm:4});expect(result.reach).toBeUndefined();
});
it("uses account totals for ratios instead of averaging campaign percentages",()=>{
 const result=dashboardInsights("meta",{spend:100,impressions:10100,clicks:20,reach:8000,conversations:7,ctr:5.05,cpm:999});
 expect(result.ctr).toBeCloseTo(20/10100*100);expect(result.cpm).toBeCloseTo(100/10100*1000);expect(result.reach).toBe(8000);expect(result.conversations).toBe(7);
});
it("requests Google data through its own endpoints with one selected period",async()=>{
 const request=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);return Response.json(url.includes("campaigns")||url.includes("daily=1")||url.includes("/crm/")?[]:{spend:40,conversions:2,conversionsValue:100});});
 const result=await loadDashboardData({id:"1234567890",platform:"google"},"client-a","last_7d",undefined,request as typeof fetch);
 const urls=request.mock.calls.map(([url])=>String(url));expect(urls.filter(url=>url.includes("/google-ads/")).length).toBe(3);expect(urls.some(url=>url.includes("/meta/"))).toBe(false);expect(urls.filter(url=>!url.includes("/crm/")).every(url=>url.includes("datePreset=last_7d"))).toBe(true);expect(result.summary?.conversions).toBe(2);
});
it("normalizes Google account separators before requesting every ads endpoint",async()=>{
 const request=vi.fn(async(input:RequestInfo|URL)=>Response.json(String(input).includes("campaigns")||String(input).includes("daily=1")||String(input).includes("/crm/")?[]:{}));
 await loadDashboardData({id:"123-456-7890",platform:"google"},"client-a","last_7d",undefined,request as typeof fetch);
 const urls=request.mock.calls.map(([url])=>String(url)).filter(url=>url.includes("/google-ads/"));
 expect(urls).toHaveLength(3);expect(urls.every(url=>url.startsWith("/api/google-ads/1234567890/"))).toBe(true);
});
it("explains expired Google authorization without displaying provider details or losing CRM",async()=>{
 const request=vi.fn(async(input:RequestInfo|URL)=>String(input).includes("/crm/")?Response.json([{id:"lead-a"}]):Response.json({error:"invalid_grant: private provider details"},{status:500}));
 const result=await loadDashboardData({id:"123",platform:"google"},"client-a","last_30d",undefined,request as typeof fetch);
 expect(result.adsReconnect).toBe(true);expect(result.adsError).toContain("reconectar o Google Ads");expect(result.adsError).not.toContain("private provider");expect(result.summary).toBeNull();expect(result.crmLeads).toEqual([{id:"lead-a"}]);
});
it("does not suggest Google reauthorization for an unrelated provider failure",async()=>{
 const request=vi.fn(async(input:RequestInfo|URL)=>String(input).includes("/crm/")?Response.json([]):Response.json({error:"permission denied"},{status:403}));
 const result=await loadDashboardData({id:"123",platform:"google"},"client-a","last_30d",undefined,request as typeof fetch);
 expect(result.adsReconnect).toBe(false);expect(result.adsError).toContain("Confira a conexão");
});
it("reports unavailable ads while preserving independently loaded CRM data",async()=>{
 const lead={id:"lead-a",clientId:"client-a"};
 const request=vi.fn(async(input:RequestInfo|URL)=>String(input).includes("/crm/")?Response.json([lead]):new Response("unavailable",{status:403}));
 const result=await loadDashboardData({id:"act_123",platform:"meta"},"client-a","last_30d",undefined,request as typeof fetch);
 expect(result.summary).toBeNull();expect(result.adsError).toBeTruthy();expect(result.crmLeads).toEqual([lead]);expect(result.crmError).toBeNull();
});
it("loads CRM even when the client has no advertising account",async()=>{
 const request=vi.fn(async()=>Response.json([{id:"lead-a"}]));const result=await loadDashboardData(undefined,"client-a","last_30d",undefined,request as typeof fetch);
 expect(request).toHaveBeenCalledTimes(1);expect(result.crmLeads).toHaveLength(1);expect(result.summary).toBeNull();
});
it("does not label a failed CRM request as an empty successful pipeline",async()=>{
 const request=vi.fn(async(input:RequestInfo|URL)=>String(input).includes("/crm/")?new Response("unavailable",{status:503}):Response.json(String(input).includes("campaigns")||String(input).includes("daily=1")?[]:{spend:10,impressions:100}));
 const result=await loadDashboardData({id:"123",platform:"meta"},"client-a","last_30d",undefined,request as typeof fetch);
 expect(result.summary?.spend).toBe(10);expect(result.adsError).toBeNull();expect(result.crmError).toBeTruthy();
});
it("uses exactly seven Brazilian calendar days even after UTC midnight",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-04T01:00:00Z"));expect(datePresetToRange("last_7d")).toEqual({since:"2026-10-28",until:"2026-11-03"});
});
it("handles month boundaries and leap years in the selected range",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2024-03-10T15:00:00Z"));expect(datePresetToRange("last_month")).toEqual({since:"2024-02-01",until:"2024-02-29"});expect(datePresetToRange("this_month")).toEqual({since:"2024-03-01",until:"2024-03-10"});
});
