import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../media-access", () => ({ canReadMedia: vi.fn(async () => true) }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true), readFileSync: vi.fn(() => Buffer.from("%PDF-fixture")) }));
import { GET } from "../../app/api/media/[filename]/route";
import { canReadMedia } from "../media-access";

const request = (name: string, query = "") => new NextRequest(`https://app.example.invalid/api/media/${name}${query}`);
const context = (filename: string) => ({ params: Promise.resolve({ filename }) });

it("opens a genuine PDF as a private, sandboxed document", async () => {
  const response = await GET(request("fixture.pdf"), context("fixture.pdf"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toContain("inline");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("forces unknown files to download without executing on the app origin", async () => {
  const response = await GET(request("fixture.bin", "?download=1&name=Planilha.xlsx"), context("fixture.bin"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(response.headers.get("content-disposition")).toContain("Planilha.xlsx");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});
it("rejects an unauthorized or invalid file path", async () => {
  vi.mocked(canReadMedia).mockResolvedValueOnce(false);
  expect((await GET(request("fixture.pdf"), context("fixture.pdf"))).status).toBe(404);
  expect((await GET(request("fixture.pdf"), context("..%2Fsecret"))).status).toBe(404);
});
