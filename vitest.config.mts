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
    // Global, not a per-test override, refs _R1#123. QA measured this
    // host across 20 full-suite runs at 61ca786. Worst single observation
    // was 5511ms, on vitest-worktree-exclude.test.ts, a test that has
    // never been reported flaky, so bot.test.ts crossing the old 5000ms
    // default first was a symptom of where the timeout line sat, not a
    // defect specific to that one file. The tail had not converged
    // between the 10 run and 20 run samples, so 5511ms is a lower bound
    // on the worst case this host will ever produce, not the ceiling.
    // QA also measured this host degrading 2 to 2.3 times in a bad run.
    // 5511 times 2.3 is roughly 12676, rounded up to 15000.
    //
    // Per-test overrides and retry are deliberately excluded. A retry
    // converts a real intermittent failure into a silent pass, which is
    // worse than the flake it would hide. Scoping the timeout to one
    // file would leave the actually-nearest test exposed and look like a
    // fix until the day that one crossed the line instead.
    //
    // The trade this makes: a genuine hang still fails, it just takes up
    // to 15 seconds instead of 5 to report. That is the correct trade,
    // since a hang is caught either way, while a merely slow test was
    // being reported as broken under the old value.
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
