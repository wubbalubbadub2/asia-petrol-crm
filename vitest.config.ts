import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
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
});
