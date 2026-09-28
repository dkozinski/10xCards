import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Vitest config rather than Astro's getViteConfig(): that helper loads
// astro.config.mjs, whose Cloudflare adapter boots a workerd runner Vitest
// cannot start ("exports is not defined") and reads .dev.vars secrets.
// Tests cover plain modules and mock anything that imports astro:* virtuals.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
