import { describe, it, expect } from "vitest";
import {
  isProdServingDeploy,
  urlIsProd,
  isBlockedProdWrite,
  assertRunwayProdWriteAllowed,
} from "./runway-prod-write-guard";

const PROD = "libsql://runway-prod.turso.io";
const STAGING = "libsql://runway-staging.turso.io";

describe("urlIsProd", () => {
  it("prod url (no 'staging') is prod", () => expect(urlIsProd(PROD)).toBe(true));
  it("staging url is not prod", () => expect(urlIsProd(STAGING)).toBe(false));
  it("empty url is not prod", () => expect(urlIsProd("")).toBe(false));
});

describe("isProdServingDeploy (re-exported shared predicate)", () => {
  it("VERCEL_ENV=production is prod-serving", () =>
    expect(isProdServingDeploy({ VERCEL_ENV: "production" })).toBe(true));
  it("runway-branch cloud deploy (marker, no PR link) is prod-serving", () =>
    expect(isProdServingDeploy({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "runway", VERCEL_DEPLOYMENT_ID: "dpl_abc" })).toBe(true));
  it("feature-branch preview is NOT prod-serving", () =>
    expect(isProdServingDeploy({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/x", VERCEL_DEPLOYMENT_ID: "dpl_x" })).toBe(false));
  it("local (no VERCEL_ENV) is NOT prod-serving", () =>
    expect(isProdServingDeploy({})).toBe(false));
});

describe("isBlockedProdWrite", () => {
  it("BLOCKS feature-branch preview resolving prod url", () =>
    expect(isBlockedProdWrite({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/x", VERCEL_DEPLOYMENT_ID: "dpl_x", RUNWAY_DATABASE_URL: PROD })).toBe(true));
  it("(a) ALLOWS a prod-serving runway-branch cloud deploy resolving prod url (outage guard)", () =>
    expect(isBlockedProdWrite({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "runway", VERCEL_DEPLOYMENT_ID: "dpl_abc", RUNWAY_DATABASE_URL: PROD })).toBe(false));
  it("(c) ALLOWS local (no VERCEL_ENV) resolving prod url", () =>
    expect(isBlockedProdWrite({ RUNWAY_DATABASE_URL: PROD })).toBe(false));
  it("(d) ALLOWS feature-branch preview resolving staging url", () =>
    expect(isBlockedProdWrite({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/x", VERCEL_DEPLOYMENT_ID: "dpl_x", RUNWAY_DATABASE_URL: STAGING })).toBe(false));
  it("ALLOWS VERCEL_ENV=production resolving prod url", () =>
    expect(isBlockedProdWrite({ VERCEL_ENV: "production", RUNWAY_DATABASE_URL: PROD })).toBe(false));
});

describe("assertRunwayProdWriteAllowed", () => {
  it("throws on a blocked preview-prod deploy, WITHOUT leaking the url", () => {
    const call = () =>
      assertRunwayProdWriteAllowed({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/x", VERCEL_DEPLOYMENT_ID: "dpl_x", RUNWAY_DATABASE_URL: PROD });
    expect(call).toThrow(/non-prod deploy/i);
    expect(call).not.toThrow(/turso\.io/);
  });
  it("does not throw for a normal production runtime", () => {
    expect(() => assertRunwayProdWriteAllowed({ VERCEL_ENV: "production", RUNWAY_DATABASE_URL: PROD })).not.toThrow();
  });
  it("does not throw for a prod-serving runway-branch cloud deploy (outage guard)", () => {
    expect(() => assertRunwayProdWriteAllowed({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "runway", VERCEL_DEPLOYMENT_ID: "dpl_abc", RUNWAY_DATABASE_URL: PROD })).not.toThrow();
  });
});
