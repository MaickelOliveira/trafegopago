import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { uploadDriveResumable } from "./drive-resumable-upload.mjs";

test("large upload resumes after a transient response without replaying completed bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexo-drive-test-"));
  try {
    const filePath = path.join(root, "encrypted");
    await writeFile(filePath, Buffer.alloc(600_000, 7));
    const sent = [];
    const fetchImpl = async (url, options) => {
      if (options.method === "POST") {
        assert.equal(new URL(url).searchParams.get("uploadType"), "resumable");
        assert.deepEqual(JSON.parse(options.body).parents, ["folder"]);
        return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } });
      }
      if (options.headers["Content-Range"].startsWith("bytes */")) return new Response(null, { status: 308, headers: { range: "bytes=0-262143" } });
      sent.push(options.headers["Content-Range"]);
      if (sent.length === 1) return new Response(null, { status: 503 });
      if (sent.length === 2) return new Response(null, { status: 308, headers: { range: "bytes=0-524287" } });
      return Response.json({ id: "drive-file", size: "600000" });
    };
    const result = await uploadDriveResumable({ accessToken: "synthetic", filePath, folderId: "folder", name: "encrypted", sha256: "a".repeat(64), fetchImpl, chunkBytes: 256 * 1024 });
    assert.deepEqual(result, { id: "drive-file", size: "600000" });
    assert.deepEqual(sent, ["bytes 0-262143/600000", "bytes 262144-524287/600000", "bytes 524288-599999/600000"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("upload refuses a session on another host", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexo-drive-test-"));
  try {
    const filePath = path.join(root, "encrypted");
    await writeFile(filePath, "encrypted");
    await assert.rejects(uploadDriveResumable({ accessToken: "synthetic", filePath, folderId: "folder", name: "encrypted", sha256: "b".repeat(64), fetchImpl: async () => new Response(null, { status: 200, headers: { location: "https://elsewhere.invalid/receive" } }) }), /Sessão de upload inválida/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
