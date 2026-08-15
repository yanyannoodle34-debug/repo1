import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../../routers/index.js";

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
