import { beforeEach, describe, expect, it, vi } from "vitest";

const { readRecordList } = vi.hoisted(() => ({ readRecordList: vi.fn() }));
vi.mock("../record-store", () => ({ readRecordList }));
vi.mock("../clients", () => ({ getConfig: vi.fn() }));

import { formMeasurementRefused, preserveFormPreference } from "../lead-ad-preference";
import { storedLeadRefusedMeasurement } from "../lead-ad-preference-store";
import { sendCapiEvent } from "../meta-capi";

describe("form advertising preference", () => {
  beforeEach(() => { readRecordList.mockReset(); });
  it("distinguishes a missing legacy field, explicit permission and refusal", () => {
    expect(formMeasurementRefused()).toBe(false);
    expect(formMeasurementRefused({ consentimento_medicao: "permitido" })).toBe(false);
    for (const choice of ["negado", "", "invalid"]) {
      expect(formMeasurementRefused({ consentimento_medicao: choice })).toBe(true);
    }
  });
  it("retains refusal across form updates until a new choice arrives", () => {
    const refusal = { consentimento_medicao: "negado" };
    expect(preserveFormPreference(refusal, { projeto: "Galpão" })).toEqual({ ...refusal, projeto: "Galpão" });
    expect(preserveFormPreference(refusal, undefined)).toEqual(refusal);
    expect(preserveFormPreference(refusal, { consentimento_medicao: "permitido" })).toEqual({ consentimento_medicao: "permitido" });
  });
  it("checks the current CRM lead when processing a queued conversion", async () => {
    readRecordList.mockResolvedValue([{ id: "test", customFields: { consentimento_medicao: "negado" } }]);
    expect(await storedLeadRefusedMeasurement("test", "client")).toBe(true);
    expect(readRecordList).toHaveBeenCalledWith("leads.json", { id: "test", clientId: "client" });
  });
  it("skips the Meta request for a lead that refused", async () => {
    readRecordList.mockResolvedValue([{ id: "test", customFields: { consentimento_medicao: "negado" } }]);
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
    try {
      await sendCapiEvent({ pixelId: "test", capiToken: "test", eventName: "Lead", externalId: "test" });
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });
});
