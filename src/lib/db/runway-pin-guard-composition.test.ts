/**
 * The #100 prod-write guard must see the url the client is ABOUT TO OPEN.
 *
 * #100 wired `assertRunwayProdWriteAllowed(process.env)` into getRunwayClient.
 * #103 then allowed the connection to be PINNED, so the env var stopped being
 * the connection. Composing the two naively leaves the guard reading one url
 * while the client opens another — the same defect #103 fixed one layer down,
 * rebuilt inside the guard.
 *
 * These pin a prod url while RUNWAY_DATABASE_URL says staging. A guard fed the
 * env var passes and the client opens prod. A guard fed the resolved url throws.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  pinRunwayConnection,
  getRunwayDb,
  resetRunwayConnectionForTests,
} from "./runway";

const saved: Record<string, string | undefined> = {};
const KEYS = [
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_GIT_PULL_REQUEST_ID",
  "RUNWAY_DATABASE_URL",
];

function stub(env: Record<string, string | undefined>) {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetRunwayConnectionForTests();
});

describe("#100 guard composed with the #103 pin", () => {
  it("blocks a non-prod deploy that PINNED a prod url, even when the env var says staging", () => {
    stub({
      VERCEL_ENV: "preview",
      RUNWAY_DATABASE_URL: "libsql://runway-staging.example.io",
    });
    resetRunwayConnectionForTests();

    // The pin is what the client will actually open.
    pinRunwayConnection("libsql://runway-prod.example.io");

    expect(() => getRunwayDb()).toThrow(/blocked/i);
  });

  it("allows a non-prod deploy that pinned a staging url", () => {
    stub({
      VERCEL_ENV: "preview",
      RUNWAY_DATABASE_URL: "libsql://runway-prod.example.io",
    });
    resetRunwayConnectionForTests();

    // Mirror image: the env var looks like prod, the pin is staging. A guard
    // reading the env var would wrongly BLOCK a legitimate staging run.
    pinRunwayConnection("libsql://runway-staging.example.io");

    expect(() => getRunwayDb()).not.toThrow();
  });

  it("falls back to the env var when nothing is pinned", () => {
    stub({
      VERCEL_ENV: "preview",
      RUNWAY_DATABASE_URL: "libsql://runway-prod.example.io",
    });
    resetRunwayConnectionForTests();

    expect(() => getRunwayDb()).toThrow(/blocked/i);
  });
});
