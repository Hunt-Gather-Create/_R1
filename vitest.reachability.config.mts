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
  },
  resolve: {
    alias: [{ find: /^next\/cache$/, replacement: "next/cache.js" }],
  },
});
