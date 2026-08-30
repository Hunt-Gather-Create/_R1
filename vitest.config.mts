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
    // default exclude, node_modules and .git, so without this the suite
    // also collects and runs every worktree's copy of every test file, on
    // whatever branch that worktree happens to be sitting on. Spread the
    // defaults rather than replacing them. Replacing would silently
    // re-enable node_modules collection, see _R1#114.
    //
    // proxy.reachability.test.ts, refs _R1#88 and _R1#118, imports the
    // real authkit-nextjs package, which cannot load under this config.
    // See vitest.reachability.config.mts for why and how to run it.
    exclude: [...configDefaults.exclude, "**/.worktrees/**", "proxy.reachability.test.ts"],
    setupFiles: ["./vitest.setup.mts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
