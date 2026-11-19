import { getConfig } from "@/lib/clients";
import { isDailyBackupConfigured } from "@/lib/backup-status";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { databasePool } from "@/lib/document-store";

export async function GET() {
  const session = await getSession();
  if (session?.role !== "manager") return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    await databasePool().query("SELECT 1");
    const latest = await databasePool().query("SELECT day,status,started_at,completed_at FROM backup_runs ORDER BY day DESC LIMIT 1");
    return NextResponse.json({ database: "connected", dailyBackupConfigured: isDailyBackupConfigured(await getConfig()), latestBackup: latest.rows[0] ?? null });
  } catch { return NextResponse.json({ database: "unavailable" }, { status: 503 }); }
}
