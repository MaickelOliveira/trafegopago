import { NextResponse } from "next/server";
import { databasePool } from "@/lib/document-store";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await databasePool().query("SELECT 1 FROM app_documents LIMIT 1"); return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({ok:false},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
