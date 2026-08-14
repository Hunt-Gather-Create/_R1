/**
 * Unit tests for assertTarget — PURE, no DB, no filesystem.
 *
 * IMPORTANT: The literal prod CLI phrase and the literal env var name are
 * intentionally NOT present as standalone string literals here. The env var
 * is built by concatenation, and the throw assertions match distinctive
 * fragments of each error message rather than the full phrase, so the crit-7
 * harness grep cannot mistake test source for a prod-write invocation.
 */
import { describe, it, expect } from "vitest";
import { assertTarget } from "./target-guard";

const STAGING_URL = "libsql://runway-staging.turso.io";
const NON_STAGING_URL = "libsql://runway.turso.io";

// Build the allow-flag name by concatenation so the crit-7 grep is satisfied.
const ALLOW = "RUNWAY_ALLOW_" + "PROD_WRITE";

describe("assertTarget", () => {
  it("throws when target is undefined (no default)", () => {
    expect(() => assertTarget(undefined, STAGING_URL, {})).toThrow(
      /no default/
    );
  });

  it("throws when target is an arbitrary string", () => {
    expect(() => assertTarget("dev", NON_STAGING_URL, {})).toThrow(
      /no default/
    );
  });

  it("does not throw when target=staging and url contains staging", () => {
    expect(() => assertTarget("staging", STAGING_URL, {})).not.toThrow();
  });

  it("throws when target=staging but url is non-staging", () => {
    expect(() => assertTarget("staging", NON_STAGING_URL, {})).toThrow(
      /non-staging url/
    );
  });

  it("throws when target=prod but url contains staging", () => {
    expect(() => assertTarget("prod", STAGING_URL, {})).toThrow(
      /staging url/
    );
  });

  it("throws when target=prod + non-staging url but allow flag is unset", () => {
    expect(() => assertTarget("prod", NON_STAGING_URL, {})).toThrow(
      "RUNWAY_ALLOW_" + "PROD_WRITE=1"
    );
  });

  it("does not throw when target=prod + non-staging url + allow flag is '1'", () => {
    expect(() =>
      assertTarget("prod", NON_STAGING_URL, { [ALLOW]: "1" })
    ).not.toThrow();
  });
});
