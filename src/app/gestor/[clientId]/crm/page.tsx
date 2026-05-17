import { redirect } from "next/navigation";

export default async function ClientCrmRedirect({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  redirect(`/gestor/crm?cliente=${clientId}`);
}
