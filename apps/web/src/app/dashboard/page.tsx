import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/get-server-session";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div>
      <h1>控制台</h1>
      <p>欢迎，{session.user.name}</p>
      <Dashboard session={session} />
    </div>
  );
}
