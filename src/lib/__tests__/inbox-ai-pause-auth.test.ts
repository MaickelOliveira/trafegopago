import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getFunnelForConnection: vi.fn(),
  getLeadForConnection: vi.fn(),
  setAiPaused: vi.fn(),
  updateLead: vi.fn(),
  cancelFollowUpsForPhone: vi.fn(),
  getEmployeeById: vi.fn(),
  employeeCanAccessFunnel: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/lead-context", () => ({
  getFunnelForConnection: mocks.getFunnelForConnection,
  getLeadForConnection: mocks.getLeadForConnection,
}));
vi.mock("@/lib/conversations", () => ({ setAiPaused: mocks.setAiPaused }));
vi.mock("@/lib/leads", () => ({ updateLead: mocks.updateLead }));
vi.mock("@/lib/followups", () => ({ cancelFollowUpsForPhone: mocks.cancelFollowUpsForPhone }));
vi.mock("@/lib/employees", () => ({
  getEmployeeById: mocks.getEmployeeById,
  employeeCanAccessFunnel: mocks.employeeCanAccessFunnel,
}));

import { POST } from "../../app/api/whatsapp/inbox/ai-pause/route";

function request() {
  return new NextRequest("http://localhost/api/whatsapp/inbox/ai-pause", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "example-client", connId: "example-connection", phone: "5511999990000", paused: false }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getFunnelForConnection.mockResolvedValue({ id: "example-funnel" });
  mocks.getLeadForConnection.mockResolvedValue(undefined);
});

describe("Inbox AI pause authorization", () => {
  it("rejects requests without a session or from another client", async () => {
    mocks.getSession.mockResolvedValueOnce(null).mockResolvedValueOnce({ role: "client", clientId: "other" });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.setAiPaused).not.toHaveBeenCalled();
  });

  it("rejects a connection not assigned to the client", async () => {
    mocks.getSession.mockResolvedValue({ role: "manager" });
    mocks.getFunnelForConnection.mockResolvedValue(undefined);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.setAiPaused).not.toHaveBeenCalled();
  });

  it("requires message permission for an employee", async () => {
    mocks.getSession.mockResolvedValue({ role: "employee", clientId: "example-client", employeeId: "employee-1" });
    mocks.getEmployeeById.mockResolvedValue({ permissions: { canManageLeadMessages: false } });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.setAiPaused).not.toHaveBeenCalled();
  });

  it("updates only the authorized conversation", async () => {
    mocks.getSession.mockResolvedValue({ role: "manager" });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.setAiPaused).toHaveBeenCalledWith("5511999990000", false, "example-client", "example-connection");
  });
});
