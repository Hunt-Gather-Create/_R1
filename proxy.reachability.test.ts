/**
 * Premise recheck for _R1#88 and _R1#118, not a permanent guard.
 *
 * _R1#52 observed an unauthenticated JSON request reaching a chat route in
 * production and the operator was told twice, as fact, that the authkit
 * login layer waves JSON requests through on an Accept header check. That
 * claim came from reading a curl observation, not the shipped package.
 *
 * proxy.test.ts calls vi.mock on authkit-nextjs and proves only that
 * proxy.ts calls authkitMiddleware with the expected config object. It
 * never runs the real middleware, so it proves nothing about whether an
 * unauthenticated request actually reaches a route handler.
 *
 * This file imports the real proxy export and drives it with real
 * NextRequest objects, no mock of authkit-nextjs anywhere. The only stub
 * is the environment: WORKOS_COOKIE_PASSWORD, WORKOS_CLIENT_ID, and
 * WORKOS_API_KEY are read once at module load inside the authkit-nextjs
 * package, so they are set before that package is ever imported, and
 * their presence is confirmed here without ever printing a value.
 *
 * No request in this file reaches a deployed host. Every case below has
 * no session cookie, so authkit-nextjs's own code path returns early from
 * getSessionFromCookie before any token verification or WorkOS API call
 * is attempted, confirmed by reading session.js directly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";

// Run with vitest.reachability.config.mts, not the shared vitest.config.mts.
// See that file's header comment for why: an ESM resolution quirk in
// authkit-nextjs's own dependency tree, not a mock of anything this test
// exercises.

const DUMMY_COOKIE_PASSWORD = "x".repeat(32);

beforeAll(() => {
  // Dynamic import happens after these assignments run, and static
  // imports of anything touching authkit-nextjs are deliberately absent
  // from this file's top level, since ES module imports are hoisted
  // ahead of ordinary statements and would read these variables unset.
  process.env.WORKOS_COOKIE_PASSWORD = DUMMY_COOKIE_PASSWORD;
  process.env.WORKOS_CLIENT_ID = "client_test_dummy_id";
  process.env.WORKOS_API_KEY = "sk_test_dummy_key";
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "https://example.invalid/callback";
  expect(process.env.WORKOS_COOKIE_PASSWORD.length).toBeGreaterThanOrEqual(32);
});

type ProxyFn = (request: import("next/server").NextRequest) => Promise<Response>;

async function loadRealProxy(): Promise<ProxyFn> {
  const mod = await import("./proxy");
  return mod.proxy as unknown as ProxyFn;
}

async function loadAuthkitMiddleware() {
  const mod = await import("@workos-inc/authkit-nextjs");
  return mod.authkitMiddleware;
}

function buildRequest(path: string, accept: string): NextRequest {
  return new NextRequest(`https://example.invalid${path}`, {
    method: "POST",
    headers: {
      accept,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspaceId: "arbitrary-workspace-id" }),
  });
}

function classify(response: Response): "redirect" | "pass-through" {
  if (response.status === 307 || response.status === 303) {
    return "redirect";
  }
  if (response.headers.get("location")) {
    return "redirect";
  }
  return "pass-through";
}

const CHAT_ROUTES = ["/api/chat", "/api/chat/issue", "/api/chat/planning", "/api/chat/workspace"];

describe("proxy reachability, the real middleware, no mock, _R1#88 and _R1#118 premise recheck", () => {
  it("harness is live: the same request moves from redirect to pass-through on a local skip-list copy", async () => {
    const authkitMiddleware = await loadAuthkitMiddleware();
    const proxy = await loadRealProxy();

    const protectedResult = classify(await proxy(buildRequest("/api/chat", "application/json")));
    expect(protectedResult).toBe("redirect");

    // A local copy of the app's own config, built from the same real
    // authkitMiddleware, with one route added to the skip list. This is
    // not a mock of authkit, it is a second real instance of the same
    // library function with different configuration, which is what
    // proves the harness actually executes the middleware's own routing
    // logic rather than returning a fixed result.
    const localSkipListProxy = authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: ["/api/chat"],
      },
    }) as unknown as ProxyFn;

    const skippedResult = classify(await localSkipListProxy(buildRequest("/api/chat", "application/json")));
    expect(skippedResult).toBe("pass-through");
    expect(skippedResult).not.toBe(protectedResult);
  });

  it("unauthenticatedPaths control: /api/slack/events passes through with no session", async () => {
    const proxy = await loadRealProxy();
    const result = classify(await proxy(buildRequest("/api/slack/events", "application/json")));
    expect(result).toBe("pass-through");
  });

  // Measured result, not an assumption: every chat route redirects an
  // unauthenticated request under both Accept shapes. If a future change
  // to proxy.ts, the authkit-nextjs dependency, or the unauthenticatedPaths
  // list ever lets one of these through, this is the assertion that goes
  // red.
  it.each(CHAT_ROUTES)("%s with Accept: application/json and no session redirects", async (path) => {
    const proxy = await loadRealProxy();
    const result = classify(await proxy(buildRequest(path, "application/json")));
    expect(result).toBe("redirect");
  });

  it.each(CHAT_ROUTES)("%s with Accept: text/html and no session redirects, the control", async (path) => {
    const proxy = await loadRealProxy();
    const result = classify(await proxy(buildRequest(path, "text/html")));
    expect(result).toBe("redirect");
  });

  it("both Accept shapes behave identically on every chat route, the actual finding", async () => {
    const proxy = await loadRealProxy();
    for (const path of CHAT_ROUTES) {
      const jsonResult = classify(await proxy(buildRequest(path, "application/json")));
      const htmlResult = classify(await proxy(buildRequest(path, "text/html")));
      expect(jsonResult).toBe(htmlResult);
    }
  });
});
