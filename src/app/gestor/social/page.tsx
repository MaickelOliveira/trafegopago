import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { SocialMediaView } from "@/components/social/SocialMediaView";

export default async function SocialPage() {
  const session = await getSession();
  if (!session || session.role !== "manager") redirect("/login");

  const clients = getClients().map((c) => ({ id: c.id, name: c.name, color: c.color }));
  return <SocialMediaView clients={clients} />;
}
