import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    // Sibling git worktrees under .worktrees/ are not covered by vitest's
    // default exclude (node_modules, .git), so without this the suite also
    // collects and runs every worktree's copy of every test file, on
    // whatever branch that worktree happens to be sitting on. Spread the
    // defaults rather than replacing them — replacing would silently
    // re-enable node_modules collection (_R1#114).
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    setupFiles: ["./vitest.setup.mts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
