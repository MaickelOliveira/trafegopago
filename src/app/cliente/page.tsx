import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function ClienteDashboard() {
  const session = await getSession();
  if (!session || session.role !== "client") redirect("/login");
  redirect("/cliente/crm");
}
