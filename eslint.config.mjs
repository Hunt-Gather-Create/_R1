import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Legacy local assets from prior preview integration.
    "public/nutrient-viewer/**",
    // docs/tmp is a scratch directory for investigation scripts and plan docs.
    "docs/tmp/**",
    // scripts/worktree-scratch is a per-worktree local scratch dir (not for the repo).
    "scripts/worktree-scratch/**",
  ]),
]);

export default eslintConfig;
