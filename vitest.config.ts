import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Pin the runtime TZ so date-math helpers (e.g. getDateRange) produce
    // the same result everywhere. Without this the price-formation tests
    // pass for devs in +05 and fail in CI's UTC because Date#setDate
    // operates in local time but toISOString() renders in UTC.
    setupFiles: ["./src/__tests__/setup-env.ts"],
    // Playwright specs live under e2e/ and import from @playwright/test,
    // which throws when Vitest tries to load them. Keep them segregated.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
