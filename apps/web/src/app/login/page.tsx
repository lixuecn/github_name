import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/get-server-session";

import LoginForms from "./login-forms";

export default async function LoginPage() {
  const session = await getServerSession();

  if (session?.user) {
    redirect("/dashboard");
  }

  return <LoginForms />;
}
