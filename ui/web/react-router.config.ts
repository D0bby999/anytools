import type { Config } from "@react-router/dev/config";

export default {
  // SSR is not optional here: this server IS the BFF. It holds the session
  // cookie, the gateway token and the OAuth client secrets, and it is the only
  // process allowed to talk to the Go API (docs/architecture.md).
  ssr: true,
} satisfies Config;
