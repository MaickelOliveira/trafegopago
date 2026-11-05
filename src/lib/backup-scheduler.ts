import { getConfig } from "./clients";
import { isDailyBackupConfigured } from "./backup-status";
import { spawn } from "node:child_process";
import path from "node:path";
import { currentHHMMBrasilia, todayISOBrasilia } from "./timezone";
import { databasePool } from "./document-store";

let running = false;
export async function runDailyBackupIfDue(): Promise<void> {
  if (running || !isDailyBackupConfigured(await getConfig()) || currentHHMMBrasilia() < (process.env.BACKUP_HOUR || "03:00")) return;
  running = true;
  try {
  const today = todayISOBrasilia();
  const previous = await databasePool().query<{ status: string }>("SELECT status FROM backup_runs WHERE day=$1", [today]);
  if (previous.rows[0]?.status === "completed") return;
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "backup.mjs")], { stdio: ["ignore", "ignore", "pipe"], env: process.env });
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Backup diário falhou.")));
    });
  } finally { running = false; }
}

let mediaRunning = false;
export async function runDailyMediaBackupIfDue(): Promise<void> {
  if (mediaRunning || !isDailyBackupConfigured(await getConfig()) || currentHHMMBrasilia() < (process.env.BACKUP_HOUR || "03:00")) return;
  mediaRunning = true;
  try {
    const previous = await databasePool().query<{ status: string }>("SELECT status FROM media_backup_runs WHERE day=$1", [todayISOBrasilia()]);
    if (previous.rows[0]?.status === "completed") return;
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "backup-media.mjs")], { stdio: ["ignore", "ignore", "pipe"], env: process.env });
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Backup de mídia falhou.")));
    });
  } finally { mediaRunning = false; }
}
