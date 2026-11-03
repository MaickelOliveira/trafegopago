import { createHash } from "node:crypto";
import { databasePool } from "./document-store";

export async function allowLoginAttempt(email: string): Promise<boolean> {
  const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const result = await databasePool().query<{ attempts: number }>(
    `INSERT INTO auth_rate_limits(key,attempts,resets_at)
     VALUES($1,1,now()+interval '15 minutes')
     ON CONFLICT(key) DO UPDATE SET
       attempts=CASE WHEN auth_rate_limits.resets_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
       resets_at=CASE WHEN auth_rate_limits.resets_at<=now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.resets_at END
     RETURNING attempts`, [key],
  );
  return result.rows[0].attempts <= 20;
}
