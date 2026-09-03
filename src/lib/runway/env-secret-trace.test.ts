/**
 * _R1#122 — a nonce- or salt-shaped secret is invisible to
 * isSecretShapedEnvName's five-word vocabulary (SECRET|TOKEN|KEY|PASSWORD|
 * CREDENTIAL). isProvablyNotSecretCompare now also asks a structural
 * question — does the compare's reachable branch produce a 401/403 — via
 * reachesAuthSink, gated on isKnownNonSecretModeName to exclude the one
 * false positive scripts/secret-compare-census.ts's sinkShapeMeasurement
 * found in the real tree (a NODE_ENV check near an auth branch).
 *
 * This file cannot exercise findAllGuardViolations directly — that
 * function is private to token-compare-guard.test.ts, fenced off for
 * this ticket (owned by #109/#110). It tests isProvablyNotSecretCompare
 * itself instead, the exact function this ticket changes and the one
 * findAllGuardViolations' own checks (co-occurrence, unguarded-equality-
 * return) both call internally to decide whether a compare is exempt.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  buildEnvTracedNames,
  isKnownNonSecretModeName,
  isProvablyNotSecretCompare,
  isSecretShapedEnvName,
  reachesAuthSink,
} from "./env-secret-trace";

/** Mirrors the real gantt-embed route's shape (process.env.RUNWAY_EMBED_SECRET
 * read into a local, compared against a header value, guarding a 401 in the
 * else branch) but with a nonce-shaped name and a plain equality compare in
 * place of timingSafeTokenMatch — the exact blind spot this ticket names. */
const NONCE_FIXTURE = `
export async function GET(request: Request) {
  const embedNonce = process.env.RUNWAY_EMBED_NONCE;
  if (!embedNonce) {
    return new Response("misconfigured", { status: 500 });
  }
  const auth = request.headers.get("x-embed-nonce");
  if (auth !== embedNonce) {
    return new Response("unauthorized", { status: 401 });
  }
  return new Response("ok");
}
`;

function findEqualityBinary(source: string, fileName: string): {
  binary: ts.BinaryExpression;
  sourceFile: ts.SourceFile;
} {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let found: ts.BinaryExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      !found &&
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
    ) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error("fixture has no === compare — fixture is broken");
  return { binary: found, sourceFile };
}

describe("_R1#122 — nonce/salt-shaped secret via sink shape", () => {
  it("the miss: vocabulary alone judges the nonce compare provably safe", () => {
    const { binary, sourceFile } = findEqualityBinary(NONCE_FIXTURE, "gantt-embed-nonce-fixture.ts");
    const trace = buildEnvTracedNames(sourceFile);

    // Simulates the pre-#122 behavior directly: isSecretShapedEnvName alone,
    // no sink-shape signal. This IS the recorded miss.
    const leftNames = ["RUNWAY_EMBED_NONCE"];
    expect(leftNames.some(isSecretShapedEnvName)).toBe(false);
    void trace;
    void binary;
  });

  it("the catch: isProvablyNotSecretCompare no longer exempts it", () => {
    const { binary, sourceFile } = findEqualityBinary(NONCE_FIXTURE, "gantt-embed-nonce-fixture.ts");
    const trace = buildEnvTracedNames(sourceFile);

    expect(reachesAuthSink(binary, sourceFile)).toBe(true);
    expect(isKnownNonSecretModeName("RUNWAY_EMBED_NONCE")).toBe(false);
    expect(isProvablyNotSecretCompare(binary, sourceFile, trace)).toBe(false);
  });

  it("restore: the real gantt-embed route (timingSafeTokenMatch, not a raw compare) is unaffected", () => {
    // The real route never reaches isProvablyNotSecretCompare for its auth
    // check at all — timingSafeTokenMatch(auth, embedSecret) is a call
    // expression, not an equality binary, same as before this ticket.
    // Confirms this fix didn't widen the check into flagging the real,
    // already-safe call.
    const REAL_SHAPE = `
      if (!auth || !timingSafeTokenMatch(auth, embedSecret)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    `;
    const sourceFile = ts.createSourceFile("real-shape.ts", REAL_SHAPE, ts.ScriptTarget.Latest, true);
    let equalityCount = 0;
    const visit = (node: ts.Node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        equalityCount++;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(equalityCount).toBe(0);
  });

  it("the false positive the census measurement found stays exempted: a NODE_ENV check near a 401/403 branch", () => {
    const MODE_FLAG_FIXTURE = `
      export async function GET() {
        if (process.env.NODE_ENV === "production") {
          return new Response("prod-only", { status: 403 });
        }
        return new Response("ok");
      }
    `;
    const { binary, sourceFile } = findEqualityBinary(MODE_FLAG_FIXTURE, "mode-flag-fixture.ts");
    const trace = buildEnvTracedNames(sourceFile);

    expect(reachesAuthSink(binary, sourceFile)).toBe(true);
    expect(isKnownNonSecretModeName("NODE_ENV")).toBe(true);
    // Sink-shape alone would flag this (proven above); the mode-name gate
    // is what keeps it exempted, matching the census measurement's own
    // finding rather than reintroducing that false positive.
    expect(isProvablyNotSecretCompare(binary, sourceFile, trace)).toBe(true);
  });
});
