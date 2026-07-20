import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

// src/lib/supabase/client.ts throws at import time if
// NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are missing from process.env. Vitest
// (unlike Next.js) does not load .env.local into process.env on its own,
// so any test that transitively imports a hook using createClient()
// (first case: fx-report-shape.test.ts importing use-fx-reports.ts) blew
// up with "Missing Supabase env vars" even though .env.local has them.
// loadEnv reads the same .env* files Next.js does and merges them in.
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: [],
      // Orphan worktrees from past `isolation: "worktree"` agent runs
      // live under .claude/worktrees/* and contain stale copies of the
      // test suite that fail with assertions matching an older config.
      // The default exclude already skips node_modules/dist; we add the
      // internal scratch dir + .next so vitest only sees the live tree.
      exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/.next/**", "**/e2e/**"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
