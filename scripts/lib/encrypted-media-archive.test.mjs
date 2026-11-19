import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { createEncryptedMediaArchive, filesNeedingBackup } from "./encrypted-media-archive.mjs";

async function run(command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.resume();
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(Error(`${command} failed`))); });
}

test("media archive decrypts and restores its original bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexo-media-test-"));
  try {
    const dataDirectory = path.join(root, "data"), mediaDirectory = path.join(dataDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    await mkdir(path.join(dataDirectory, "uploads"));
    const bytes = randomBytes(8192);
    await writeFile(path.join(mediaDirectory, "example.ogg"), bytes);
    await writeFile(path.join(dataDirectory, "uploads", "example.pdf"), bytes);
    const key = randomBytes(32), output = path.join(root, "archive.enc"), decrypted = path.join(root, "archive.tar.gz"), restored = path.join(root, "restored");
    const result = await createEncryptedMediaArchive({ dataDirectory, output, key });
    assert.equal(result.fileCount, 2);
    assert.equal(result.sourceBytes, bytes.length * 2);
    assert.notDeepEqual((await readFile(output)).subarray(0, 32), bytes.subarray(0, 32));
    await run(process.execPath, ["scripts/decrypt-backup.mjs", output, decrypted], { ...process.env, BACKUP_ENCRYPTION_KEY: key.toString("base64") });
    await mkdir(restored);
    await run("tar", ["-xzf", decrypted, "-C", restored]);
    assert.deepEqual(await readFile(path.join(restored, "media", "example.ogg")), bytes);
    assert.deepEqual(await readFile(path.join(restored, "uploads", "example.pdf")), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("media archive refuses symlinks outside the media directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexo-media-test-"));
  try {
    const dataDirectory = path.join(root, "data"), mediaDirectory = path.join(dataDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    await symlink(path.join(root, "secret"), path.join(mediaDirectory, "escape"));
    await assert.rejects(createEncryptedMediaArchive({ dataDirectory, output: path.join(root, "archive.enc"), key: randomBytes(32) }), /Entrada inesperada/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("daily run selects only new or changed files", () => {
  const scanned = [{ relativePath: "media/one.ogg", bytes: 10, mtimeMs: 100 }, { relativePath: "uploads/two.pdf", bytes: 20, mtimeMs: 200 }];
  assert.deepEqual(filesNeedingBackup(scanned, [{ relative_path: "media/one.ogg", bytes: "10", mtime_ms: "100" }]), [scanned[1]]);
  assert.deepEqual(filesNeedingBackup(scanned, [{ relative_path: "media/one.ogg", bytes: "10", mtime_ms: "99" }]), scanned);
});
