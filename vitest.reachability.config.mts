import { defineConfig, configDefaults } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone config for proxy.reachability.test.ts only, refs _R1#88 and
// _R1#118. authkit-nextjs's compiled auth.js imports next/cache with no
// file extension. Real Next.js resolves that through its own bundler,
// but Vitest's plain ESM loader requires an exact file match, and the
// nested next install this dependency pins has no exports map entry for
// the bare specifier. The alias below rewrites the specifier to the file
// that already exists, next/cache.js, before resolution runs, so Node's
// normal per importer node_modules lookup finds the correct nested copy
// on its own. This does not touch authkit-nextjs's own code and does not
// change anything the routing decision under test depends on. auth.js's
// import of next/cache is used only by its signOut and session refresh
// helpers, neither of which this test calls or the no session middleware
// path reaches. session.js, middleware.js, and middleware-helpers.js,
// the three files that actually decide redirect versus pass through,
// import neither next/cache nor anything this alias touches.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["proxy.reachability.test.ts"],
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    server: {
      // Vitest externalizes node_modules packages by default, loading
      // them through Node's native resolver, which never sees the alias
      // below. Inlining this one package routes it through Vite's own
      // transform pipeline instead, where the alias actually applies.
      deps: {
        inline: [/@workos-inc\/authkit-nextjs/],
      },
    },
    // Same values as vitest.config.mts, same measured reason, refs
    // _R1#123. This suite is manually invoked today, so on its own it
    // would not have hit the variance QA measured on the main suite.
    // _R1#125 exists to wire this suite into CI, and the moment that
    // lands it starts running on every PR, on this same host, under
    // the same variance. A config that is only correct while nobody
    // automates it is a trap with a date on it, so the numbers move
    // now rather than waiting for _R1#125 to land and rediscover the
    // same flake as a new problem instead of a known one.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: [{ find: /^next\/cache$/, replacement: "next/cache.js" }],
  },
});
