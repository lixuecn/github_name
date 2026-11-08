import type { AppRouter } from "@my-better-t-app/api/routers/index";
import { environmentManager, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      /** Skip the global error toast; the component renders the error itself. */
      silent?: boolean;
    };
  }
}

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.silent) {
          return;
        }
        toast.error(error.message, {
          action: {
            label: "重试",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (environmentManager.isServer()) {
    return makeQueryClient();
  }

  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${process.env.NEXT_PUBLIC_SERVER_URL!.replace(/\/$/, "")}/trpc`,
      }),
    ],
  });
}
