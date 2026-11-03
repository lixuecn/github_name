import { headers } from "next/headers";

import { authClient } from "@/lib/auth-client";

/** Resolves the current session on the server; an unreachable auth server counts as signed out. */
export async function getServerSession() {
  try {
    return await authClient.getSession({
      fetchOptions: {
        headers: await headers(),
        throw: true,
      },
    });
  } catch {
    return null;
  }
}
