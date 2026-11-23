import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://doko.lt",
  // Reachable from a phone on the same Wi-Fi during `bun run dev`.
  server: { host: true },
  devToolbar: { enabled: false },
});
